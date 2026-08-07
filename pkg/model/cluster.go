package model

type Cluster struct {
	Model
	Name               string       `json:"name" gorm:"type:varchar(100);uniqueIndex;not null"`
	Description        string       `json:"description" gorm:"type:text"`
	Config             SecretString `json:"config" gorm:"type:text"`
	PrometheusURL      string       `json:"prometheus_url,omitempty" gorm:"type:text"`
	InCluster          bool         `json:"in_cluster" gorm:"type:boolean;default:false"`
	Connector          bool         `json:"connector" gorm:"type:boolean;default:false"`
	ConnectorTokenHash string       `json:"-" gorm:"type:varchar(64);index"`
	IsDefault          bool         `json:"is_default" gorm:"type:boolean;default:false"`
	Enable             bool         `json:"enable" gorm:"type:boolean;default:true"`
}

func AddCluster(cluster *Cluster) error {
	return DB.Create(cluster).Error
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

func GetClusterByConnectorTokenHash(hash string) (*Cluster, error) {
	var cluster Cluster
	if err := DB.Where("connector_token_hash = ?", hash).First(&cluster).Error; err != nil {
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
