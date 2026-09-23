package model

import (
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Cluster struct {
	Model
	UUID                   string       `json:"uuid" gorm:"type:varchar(36);uniqueIndex"`
	Name                   string       `json:"name" gorm:"type:varchar(100);uniqueIndex;not null"`
	Description            string       `json:"description" gorm:"type:text"`
	Config                 SecretString `json:"config" gorm:"type:text"`
	PrometheusURL          string       `json:"prometheus_url,omitempty" gorm:"type:text"`
	InCluster              bool         `json:"in_cluster" gorm:"type:boolean;default:false"`
	ClusterAgent           bool         `json:"clusterAgent" gorm:"type:boolean;default:false"`
	ClusterAgentTokenHash  string       `json:"-" gorm:"type:varchar(64);index"`
	ClusterAgentPublicKey  string       `json:"-" gorm:"type:varchar(64)"`
	ClusterAgentPrivateKey SecretString `json:"-" gorm:"type:text"`
	IsDefault              bool         `json:"is_default" gorm:"type:boolean;default:false"`
	Enable                 bool         `json:"enable" gorm:"type:boolean;default:true"`
}

func (cluster *Cluster) BeforeCreate(*gorm.DB) error {
	if cluster.UUID == "" {
		cluster.UUID = uuid.NewString()
	}
	return nil
}

func AddCluster(cluster *Cluster) error {
	return DB.Create(cluster).Error
}

func GetClusterByUUID(value string) (*Cluster, error) {
	var cluster Cluster
	if err := DB.Where("uuid = ?", value).First(&cluster).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

// BackfillClusterUUIDs assigns UUIDv4 values to legacy clusters. The database
// unique index remains the authority if concurrent instances race.
func BackfillClusterUUIDs() error {
	for {
		var clusters []Cluster
		if err := DB.Where("uuid IS NULL OR uuid = ?", "").Find(&clusters).Error; err != nil {
			return err
		}
		if len(clusters) == 0 {
			return nil
		}
		for _, cluster := range clusters {
			for {
				result := DB.Model(&Cluster{}).Where("id = ? AND (uuid IS NULL OR uuid = ?)", cluster.ID, "").Update("uuid", uuid.NewString())
				if result.Error == nil || !errors.Is(result.Error, gorm.ErrDuplicatedKey) {
					if result.Error != nil {
						return result.Error
					}
					break
				}
			}
		}
	}
}

func GetClusterByName(name string) (*Cluster, error) {
	var cluster Cluster
	if err := DB.Where("name = ?", name).First(&cluster).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

func GetClusterByID(id uint) (*Cluster, error) {
	var cluster Cluster
	if err := DB.First(&cluster, id).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

func GetClusterByClusterAgentTokenHash(hash string) (*Cluster, error) {
	var cluster Cluster
	if err := DB.Where("cluster_agent_token_hash = ?", hash).First(&cluster).Error; err != nil {
		return nil, err
	}
	return &cluster, nil
}

func UpdateCluster(cluster *Cluster, updates map[string]interface{}) error {
	return DB.Model(cluster).Updates(updates).Error
}

func DeleteCluster(cluster *Cluster) error {
	return DB.Delete(cluster).Error
}

func ClearDefaultCluster() error {
	return DB.Model(&Cluster{}).Where("is_default = ?", true).Update("is_default", false).Error
}

func DisableCluster(cluster *Cluster) error {
	return DB.Model(cluster).Update("enable", false).Error
}

func EnableCluster(cluster *Cluster) error {
	return DB.Model(cluster).Update("enable", true).Error
}

func ListClusters() ([]*Cluster, error) {
	var clusters []*Cluster
	if err := DB.Find(&clusters).Error; err != nil {
		return nil, err
	}
	return clusters, nil
}

func CountClusters() (count int64, err error) {
	return count, DB.Model(&Cluster{}).Count(&count).Error
}
