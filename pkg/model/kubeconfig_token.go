package model

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
)

type KubeconfigToken struct {
	Model
	JTIHash      string     `json:"-" gorm:"type:varchar(64);uniqueIndex;not null"`
	OwnerID      uint       `json:"ownerId" gorm:"index;not null"`
	Name         string     `json:"name" gorm:"type:varchar(255);not null"`
	ExpiresAt    time.Time  `json:"expiresAt" gorm:"index;not null"`
	LastUsedAt   *time.Time `json:"lastUsedAt,omitempty"`
	SigningKeyID string     `json:"signingKeyId" gorm:"type:varchar(255);not null"`
	Owner        *User      `json:"owner,omitempty" gorm:"foreignKey:OwnerID"`
}

func GetKubeconfigTokenByJTIHash(jtiHash string) (*KubeconfigToken, error) {
	var token KubeconfigToken
	if err := DB.Where("jti_hash = ?", jtiHash).First(&token).Error; err != nil {
		return nil, err
	}
	return &token, nil
}

func ListKubeconfigTokens(ownerID uint) ([]KubeconfigToken, error) {
	var tokens []KubeconfigToken
	return tokens, DB.Where("owner_id = ?", ownerID).Order("created_at DESC").Find(&tokens).Error
}

type KubeconfigTokenListOptions struct {
	Page   int
	Size   int
	Owner  string
	Status string
}

func ListAdminKubeconfigTokens(options KubeconfigTokenListOptions) ([]KubeconfigToken, int64, error) {
	var tokens []KubeconfigToken
	query := DB.Model(&KubeconfigToken{}).Joins("JOIN users ON users.id = kubeconfig_tokens.owner_id")
	if options.Owner != "" {
		query = query.Where("LOWER(users.username) LIKE ?", "%"+strings.ToLower(options.Owner)+"%")
	}
	now := time.Now().UTC()
	switch options.Status {
	case "active":
		query = query.Where("kubeconfig_tokens.expires_at > ?", now)
	case "expired":
		query = query.Where("kubeconfig_tokens.expires_at <= ?", now)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Preload("Owner").Order("kubeconfig_tokens.created_at DESC").Offset((options.Page - 1) * options.Size).Limit(options.Size).Find(&tokens).Error
	return tokens, total, err
}

func TouchKubeconfigToken(id uint) error {
	now := time.Now().UTC()
	return DB.Model(&KubeconfigToken{}).Where("id = ?", id).Update("last_used_at", now).Error
}

func DeleteKubeconfigToken(id uint, ownerID *uint) (bool, error) {
	query := DB.Where("id = ?", id)
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	result := query.Delete(&KubeconfigToken{})
	return result.RowsAffected > 0, result.Error
}

func IsKubeconfigTokenNotFound(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }
