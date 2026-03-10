package model

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/zxh326/kite/pkg/utils"
)

type SecretString string

// Scan implements the sql.Scanner interface for reading encrypted data from database
func (s *SecretString) Scan(value interface{}) error {
	if value == nil {
		*s = ""
		return nil
	}
	var encryptedStr string
	switch v := value.(type) {
	case string:
		encryptedStr = v
	case []byte:
		encryptedStr = string(v)
	default:
		return fmt.Errorf("cannot scan %T into SecretString", value)
	}
	// If the string is empty, just set it directly
	if encryptedStr == "" {
		*s = ""
		return nil
	}

	// Decrypt the string
	decrypted, err := utils.DecryptString(encryptedStr)
	if err != nil {
		return fmt.Errorf("failed to decrypt SecretString: %w", err)
	}
	*s = SecretString(decrypted)
	return nil
}

// Value implements the driver.Valuer interface for writing encrypted data to database
func (s SecretString) Value() (driver.Value, error) {
	if s == "" {
		return "", nil
	}
	encrypted := utils.EncryptString(string(s))
	if len(encrypted) > 17 && encrypted[:17] == "encryption_error:" {
		return nil, fmt.Errorf("encryption failed: %s", encrypted[17:])
	}
	return encrypted, nil
}

type LowerCaseString string

func (s *LowerCaseString) Scan(value interface{}) error {
	if value == nil {
		*s = ""
		return nil
	}
	var str string
	switch v := value.(type) {
	case string:
		str = v
	case []byte:
		str = string(v)
	default:
		return fmt.Errorf("cannot scan %T into LowerCaseString", value)
	}
	*s = LowerCaseString(strings.ToLower(str))
	return nil
}

func (s LowerCaseString) Value() (driver.Value, error) {
	return strings.ToLower(string(s)), nil
}

type SliceString []string

func (s *SliceString) Scan(value interface{}) error {
	if value == nil {
		*s = nil
		return nil
	}
	var strArray []string
	switch v := value.(type) {
	case string:
		strArray = strings.Split(v, ",")
	case []byte:
		strArray = strings.Split(string(v), ",")
	default:
		return fmt.Errorf("cannot scan %T into SliceString", value)
	}
	*s = SliceString(strArray)
	return nil
}

func (s SliceString) Value() (driver.Value, error) {
	if s == nil {
		return "", nil
	}
	return strings.Join(s, ","), nil
}

// JSONField stores arbitrary JSON data
type JSONField []byte

func (j *JSONField) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	switch v := value.(type) {
	case string:
		*j = []byte(v)
	case []byte:
		*j = v
	default:
		return fmt.Errorf("cannot scan %T into JSONField", value)
	}
	return nil
}

func (j JSONField) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return string(j), nil
}

// Unmarshal deserializes the JSON data into the provided interface
func (j JSONField) Unmarshal(v interface{}) error {
	if j == nil {
		return nil
	}
	return json.Unmarshal(j, v)
}

// Marshal serializes the provided interface into JSON
func (j *JSONField) Marshal(v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	*j = data
	return nil
}
