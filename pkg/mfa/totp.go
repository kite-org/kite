package mfa

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/skip2/go-qrcode"
)

const (
	issuer     = "Kite"
	secretSize = 20
	step       = 30
	digits     = 6
)

var base32NoPadding = base32.StdEncoding.WithPadding(base32.NoPadding)

func GenerateSecret() (string, error) {
	buf := make([]byte, secretSize)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base32NoPadding.EncodeToString(buf), nil
}

func URL(username string, secret string) string {
	label := issuer
	if username != "" {
		label += ":" + username
	}
	params := url.Values{}
	params.Set("secret", secret)
	params.Set("issuer", issuer)
	return "otpauth://totp/" + url.PathEscape(label) + "?" + params.Encode()
}

func QRCodeDataURL(value string) (string, error) {
	png, err := qrcode.Encode(value, qrcode.Medium, 192)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}

func Verify(secret string, code string) bool {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != digits {
		return false
	}
	if _, err := strconv.Atoi(code); err != nil {
		return false
	}

	counter := time.Now().Unix() / step
	for offset := int64(-1); offset <= 1; offset++ {
		if generateCode(secret, uint64(counter+offset)) == code {
			return true
		}
	}
	return false
}

func generateCode(secret string, counter uint64) string {
	key, err := base32NoPadding.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return ""
	}

	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)

	hash := hmac.New(sha1.New, key)
	_, _ = hash.Write(msg[:])
	sum := hash.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1000000)
}
