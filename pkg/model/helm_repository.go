package model

type HelmRepository struct {
	Model
	Name     string       `json:"name" gorm:"type:varchar(255);uniqueIndex;not null"`
	URL      string       `json:"url" gorm:"type:varchar(1024);not null"`
	Username string       `json:"username,omitempty" gorm:"type:varchar(255)"`
	Password SecretString `json:"-" gorm:"type:text"`
}
