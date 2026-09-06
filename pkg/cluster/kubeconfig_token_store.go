package cluster

import (
	"context"
	"strconv"

	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/statefultoken"
)

type kubeconfigTokenStore struct{}

func (kubeconfigTokenStore) Create(_ context.Context, record statefultoken.Record) (statefultoken.Record, error) {
	ownerID, err := strconv.ParseUint(record.SubjectID, 10, 64)
	if err != nil {
		return statefultoken.Record{}, err
	}
	modelRecord := &model.KubeconfigToken{
		JTIHash: record.JTIHash, OwnerID: uint(ownerID), Name: record.Name,
		ExpiresAt: record.ExpiresAt, SigningKeyID: record.SigningKeyID,
	}
	if err := model.DB.Create(modelRecord).Error; err != nil {
		return statefultoken.Record{}, err
	}
	record.ID = modelRecord.ID
	return record, nil
}

func (kubeconfigTokenStore) FindByJTIHash(_ context.Context, jtiHash string) (statefultoken.Record, error) {
	record, err := model.GetKubeconfigTokenByJTIHash(jtiHash)
	if err != nil {
		return statefultoken.Record{}, err
	}
	return statefultoken.Record{
		ID: record.ID, JTIHash: record.JTIHash, SubjectID: strconv.FormatUint(uint64(record.OwnerID), 10),
		Name: record.Name, ExpiresAt: record.ExpiresAt, SigningKeyID: record.SigningKeyID,
	}, nil
}

func (kubeconfigTokenStore) Touch(_ context.Context, tokenID uint) error {
	return model.TouchKubeconfigToken(tokenID)
}

func (kubeconfigTokenStore) Delete(_ context.Context, tokenID uint, subjectID *string) (bool, error) {
	var ownerID *uint
	if subjectID != nil {
		owner, err := strconv.ParseUint(*subjectID, 10, 64)
		if err != nil {
			return false, err
		}
		value := uint(owner)
		ownerID = &value
	}
	return model.DeleteKubeconfigToken(tokenID, ownerID)
}
