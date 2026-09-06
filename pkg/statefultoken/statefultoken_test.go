package statefultoken

import (
	"context"
	"errors"
	"testing"
	"time"
)

type memoryStore struct {
	record *Record
}

func (s *memoryStore) Create(_ context.Context, record Record) (Record, error) {
	record.ID = 1
	s.record = &record
	return record, nil
}

func (s *memoryStore) FindByJTIHash(_ context.Context, hash string) (Record, error) {
	if s.record == nil || s.record.JTIHash != hash {
		return Record{}, errors.New("not found")
	}
	return *s.record, nil
}

func (s *memoryStore) Delete(_ context.Context, tokenID uint, subjectID *string) (bool, error) {
	if s.record == nil || s.record.ID != tokenID || (subjectID != nil && s.record.SubjectID != *subjectID) {
		return false, nil
	}
	s.record = nil
	return true, nil
}

func (*memoryStore) Touch(context.Context, uint) error { return nil }

func TestIssueAndAuthenticateChecksState(t *testing.T) {
	store := &memoryStore{}
	service, err := New(Config{Issuer: "kite", Purpose: "kubeconfig", Secret: []byte("secret"), KeyID: "primary"}, store)
	if err != nil {
		t.Fatal(err)
	}
	issued, err := service.Issue(context.Background(), IssueRequest{SubjectID: "42", Name: "test", ExpiresAt: time.Now().UTC().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	principal, err := service.Authenticate(context.Background(), issued.Encoded)
	if err != nil || principal.SubjectID != "42" || principal.TokenID != issued.Record.ID {
		t.Fatalf("principal=%#v err=%v", principal, err)
	}
	deleted, err := service.Delete(context.Background(), issued.Record.ID, nil)
	if err != nil || !deleted {
		t.Fatalf("delete token deleted=%v err=%v", deleted, err)
	}
	if _, err := service.Authenticate(context.Background(), issued.Encoded); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("authenticate deleted token error = %v", err)
	}
}

func TestAuthenticateRejectsWrongPurpose(t *testing.T) {
	store := &memoryStore{}
	issuer, err := New(Config{Issuer: "kite", Purpose: "other", Secret: []byte("secret"), KeyID: "primary"}, store)
	if err != nil {
		t.Fatal(err)
	}
	issued, err := issuer.Issue(context.Background(), IssueRequest{SubjectID: "42", Name: "test", ExpiresAt: time.Now().UTC().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	consumer, err := New(Config{Issuer: "kite", Purpose: "kubeconfig", Secret: []byte("secret"), KeyID: "primary"}, store)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := consumer.Authenticate(context.Background(), issued.Encoded); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("authenticate wrong-purpose token error = %v", err)
	}
}
