package model

import (
	"errors"

	"gorm.io/gorm"
)

// PluginSetting stores the JSON configuration of one installed plugin.
type PluginSetting struct {
	Model
	PluginID string `json:"pluginId" gorm:"uniqueIndex;type:varchar(64);not null"`
	Data     string `json:"data" gorm:"type:text"`
}

func GetPluginSetting(pluginID string) (string, error) {
	var setting PluginSetting
	err := DB.First(&setting, "plugin_id = ?", pluginID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return setting.Data, nil
}

func SavePluginSetting(pluginID, data string) error {
	var setting PluginSetting
	err := DB.First(&setting, "plugin_id = ?", pluginID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DB.Create(&PluginSetting{PluginID: pluginID, Data: data}).Error
	}
	if err != nil {
		return err
	}
	return DB.Model(&setting).Update("data", data).Error
}

func DeletePluginSetting(pluginID string) error {
	return DB.Where("plugin_id = ?", pluginID).Delete(&PluginSetting{}).Error
}
