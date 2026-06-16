package model

import "time"

type PasskeyCredential struct {
	Model
	UserID       uint         `json:"-" gorm:"index;not null"`
	Name         string       `json:"name" gorm:"type:varchar(100);not null"`
	CredentialID string       `json:"credential_id" gorm:"type:varchar(512);uniqueIndex;not null"`
	Credential   SecretString `json:"-" gorm:"type:text;not null"`
	LastUsedAt   *time.Time   `json:"last_used_at,omitempty" gorm:"type:timestamp;index"`
}

func ListPasskeyCredentialsByUserID(userID uint) ([]PasskeyCredential, error) {
	var credentials []PasskeyCredential
	err := DB.Where("user_id = ?", userID).Order("id desc").Find(&credentials).Error
	return credentials, err
}

func GetPasskeyCredentialByID(id uint, userID uint) (*PasskeyCredential, error) {
	var credential PasskeyCredential
	if err := DB.Where("id = ? AND user_id = ?", id, userID).First(&credential).Error; err != nil {
		return nil, err
	}
	return &credential, nil
}

func GetPasskeyCredentialByCredentialID(credentialID string) (*PasskeyCredential, error) {
	var credential PasskeyCredential
	if err := DB.Where("credential_id = ?", credentialID).First(&credential).Error; err != nil {
		return nil, err
	}
	return &credential, nil
}

func CreatePasskeyCredential(credential *PasskeyCredential) error {
	return DB.Create(credential).Error
}

func UpdatePasskeyCredential(credential *PasskeyCredential) error {
	return DB.Save(credential).Error
}

func DeletePasskeyCredential(id uint, userID uint) error {
	return DB.Where("id = ? AND user_id = ?", id, userID).Delete(&PasskeyCredential{}).Error
}
