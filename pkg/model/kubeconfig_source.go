package model

type KubeconfigSource struct {
	Model
	Key     string   `json:"-" gorm:"size:64;uniqueIndex;not null"`
	Paths   []string `json:"paths" gorm:"serializer:json;type:text"`
	Enabled bool     `json:"-" gorm:"not null;default:true"`
	Error   string   `json:"error,omitempty" gorm:"type:text"`
}
