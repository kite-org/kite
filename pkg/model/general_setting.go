package model

import (
	"errors"

	"gorm.io/gorm"
)

const DefaultGeneralAIModel = "gpt-4o-mini"
const DefaultGeneralKubectlImage = "zzde/kubectl:latest"

type GeneralSetting struct {
	Model
	AIAgentEnabled bool         `json:"aiAgentEnabled" gorm:"column:ai_agent_enabled;type:boolean;not null;default:false"`
	AIModel        string       `json:"aiModel" gorm:"column:ai_model;type:varchar(255);not null;default:'gpt-4o-mini'"`
	AIAPIKey       SecretString `json:"aiApiKey" gorm:"column:ai_api_key;type:text"`
	AIBaseURL      string       `json:"aiBaseUrl" gorm:"column:ai_base_url;type:varchar(500)"`
	KubectlEnabled bool         `json:"kubectlEnabled" gorm:"column:kubectl_enabled;type:boolean;not null;default:true"`
	KubectlImage   string       `json:"kubectlImage" gorm:"column:kubectl_image;type:varchar(255);not null;default:'zzde/kubectl:latest'"`
}

func GetGeneralSetting() (*GeneralSetting, error) {
	var setting GeneralSetting
	err := DB.First(&setting, 1).Error
	if err == nil {
		updates := map[string]interface{}{}
		if setting.AIModel == "" {
			setting.AIModel = DefaultGeneralAIModel
			updates["ai_model"] = DefaultGeneralAIModel
		}
		if setting.KubectlImage == "" {
			setting.KubectlImage = DefaultGeneralKubectlImage
			updates["kubectl_image"] = DefaultGeneralKubectlImage
		}
		if len(updates) > 0 {
			_ = DB.Model(&setting).Updates(updates).Error
		}
		return &setting, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	setting = GeneralSetting{
		Model:          Model{ID: 1},
		AIAgentEnabled: false,
		AIModel:        DefaultGeneralAIModel,
		KubectlEnabled: true,
		KubectlImage:   DefaultGeneralKubectlImage,
	}
	if err := DB.Create(&setting).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

func UpdateGeneralSetting(updates map[string]interface{}) (*GeneralSetting, error) {
	setting, err := GetGeneralSetting()
	if err != nil {
		return nil, err
	}
	if err := DB.Model(setting).Updates(updates).Error; err != nil {
		return nil, err
	}
	if err := DB.First(setting, setting.ID).Error; err != nil {
		return nil, err
	}
	return setting, nil
}
