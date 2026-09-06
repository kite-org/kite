package statefultoken

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrInvalidToken = errors.New("invalid stateful token")
	ErrExpired      = errors.New("stateful token expired")
)

type Record struct {
	ID           uint
	JTIHash      string
	SubjectID    string
	Name         string
	ExpiresAt    time.Time
	SigningKeyID string
}

type Store interface {
	Create(context.Context, Record) (Record, error)
	FindByJTIHash(context.Context, string) (Record, error)
	Delete(context.Context, uint, *string) (bool, error)
	Touch(context.Context, uint) error
}

type Config struct {
	Issuer  string
	Purpose string
	Secret  []byte
	KeyID   string
}

type IssueRequest struct {
	SubjectID string
	Name      string
	ExpiresAt time.Time
}

type IssuedToken struct {
	Encoded string
	Record  Record
}

type Principal struct {
	TokenID   uint
	SubjectID string
	ExpiresAt time.Time
	KeyID     string
}

type claims struct {
	Purpose string `json:"token_use"`
	jwt.RegisteredClaims
}

type Service struct {
	config Config
	store  Store
	now    func() time.Time
}

func New(config Config, store Store) (*Service, error) {
	if config.Issuer == "" || config.Purpose == "" || len(config.Secret) == 0 || config.KeyID == "" {
		return nil, errors.New("stateful token configuration is incomplete")
	}
	if store == nil {
		return nil, errors.New("stateful token store is required")
	}
	return &Service{config: config, store: store, now: func() time.Time { return time.Now().UTC() }}, nil
}

func HashJTI(jti string) string {
	sum := sha256.Sum256([]byte(jti))
	return hex.EncodeToString(sum[:])
}

func (s *Service) Issue(ctx context.Context, request IssueRequest) (IssuedToken, error) {
	if request.SubjectID == "" || request.Name == "" || !request.ExpiresAt.After(s.now()) {
		return IssuedToken{}, ErrInvalidToken
	}
	jti, err := randomJTI()
	if err != nil {
		return IssuedToken{}, err
	}
	now := s.now()
	tokenClaims := claims{Purpose: s.config.Purpose, RegisteredClaims: jwt.RegisteredClaims{
		Issuer: s.config.Issuer, Subject: request.SubjectID, ID: jti,
		IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(request.ExpiresAt),
	}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, tokenClaims)
	token.Header["kid"] = s.config.KeyID
	encoded, err := token.SignedString(s.config.Secret)
	if err != nil {
		return IssuedToken{}, err
	}
	record, err := s.store.Create(ctx, Record{
		JTIHash: HashJTI(jti), SubjectID: request.SubjectID, Name: request.Name, ExpiresAt: request.ExpiresAt, SigningKeyID: s.config.KeyID,
	})
	if err != nil {
		return IssuedToken{}, err
	}
	return IssuedToken{Encoded: encoded, Record: record}, nil
}

func (s *Service) Authenticate(ctx context.Context, encoded string) (Principal, error) {
	parsedClaims := &claims{}
	token, err := jwt.ParseWithClaims(encoded, parsedClaims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 || token.Header["kid"] != s.config.KeyID {
			return nil, ErrInvalidToken
		}
		return s.config.Secret, nil
	}, jwt.WithIssuer(s.config.Issuer), jwt.WithLeeway(0))
	if err != nil || !token.Valid || parsedClaims.Purpose != s.config.Purpose || parsedClaims.Subject == "" || parsedClaims.ID == "" || parsedClaims.IssuedAt == nil || parsedClaims.NotBefore == nil || parsedClaims.ExpiresAt == nil {
		return Principal{}, ErrInvalidToken
	}
	record, err := s.store.FindByJTIHash(ctx, HashJTI(parsedClaims.ID))
	if err != nil || record.SubjectID != parsedClaims.Subject || record.SigningKeyID != s.config.KeyID || record.ExpiresAt.Unix() != parsedClaims.ExpiresAt.Unix() {
		return Principal{}, ErrInvalidToken
	}
	if !s.now().Before(record.ExpiresAt) {
		return Principal{}, ErrExpired
	}
	return Principal{TokenID: record.ID, SubjectID: record.SubjectID, ExpiresAt: record.ExpiresAt, KeyID: record.SigningKeyID}, nil
}

func (s *Service) Touch(ctx context.Context, tokenID uint) error {
	return s.store.Touch(ctx, tokenID)
}

func (s *Service) Delete(ctx context.Context, tokenID uint, subjectID *string) (bool, error) {
	return s.store.Delete(ctx, tokenID, subjectID)
}

func (s *Service) Discard(ctx context.Context, tokenID uint) error {
	_, err := s.store.Delete(ctx, tokenID, nil)
	return err
}

func randomJTI() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate token ID: %w", err)
	}
	return hex.EncodeToString(value), nil
}
