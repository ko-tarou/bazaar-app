package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var db *pgxpool.Pool

type Product struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Price       *int      `json:"price"`
	ImageURL    string    `json:"image_url"`
	CreatedAt   time.Time `json:"created_at"`
}

func main() {
	dsn := getEnv("DATABASE_URL", "postgres://localhost/bazaar_db")
	var err error
	db, err = pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatalf("DB接続失敗: %v", err)
	}
	defer db.Close()

	if err := db.Ping(context.Background()); err != nil {
		log.Fatalf("DB ping失敗: %v", err)
	}
	log.Println("DB接続成功")

	r := gin.Default()

	r.Use(corsMiddleware())

	r.Static("/uploads", "./uploads")

	api := r.Group("/api")
	{
		api.GET("/products", getProducts)
		api.POST("/products", createProduct)
		api.DELETE("/products/:id", deleteProduct)
	}

	port := getEnv("PORT", "8080")
	log.Printf("サーバー起動: http://localhost:%s", port)
	r.Run(":" + port)
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "http://localhost:3000")
		c.Header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func getProducts(c *gin.Context) {
	rows, err := db.Query(context.Background(),
		"SELECT id, name, description, price, image_url, created_at FROM products ORDER BY created_at DESC")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Price, &p.ImageURL, &p.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		products = append(products, p)
	}
	c.JSON(http.StatusOK, products)
}

func createProduct(c *gin.Context) {
	name := c.PostForm("name")
	description := c.PostForm("description")
	priceStr := c.PostForm("price")

	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name は必須です"})
		return
	}

	var price *int
	if priceStr != "" {
		p, err := strconv.Atoi(priceStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "price は整数で入力してください"})
			return
		}
		price = &p
	}

	imageURL := ""
	file, err := c.FormFile("image")
	if err == nil {
		ext := filepath.Ext(file.Filename)
		filename := fmt.Sprintf("%s%s", uuid.New().String(), ext)
		savePath := filepath.Join("uploads", filename)
		if err := c.SaveUploadedFile(file, savePath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "画像保存失敗"})
			return
		}
		imageURL = "/uploads/" + filename
	}

	var id string
	err = db.QueryRow(context.Background(),
		"INSERT INTO products (name, description, price, image_url) VALUES ($1, $2, $3, $4) RETURNING id",
		name, description, price, imageURL,
	).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var p Product
	db.QueryRow(context.Background(),
		"SELECT id, name, description, price, image_url, created_at FROM products WHERE id=$1", id,
	).Scan(&p.ID, &p.Name, &p.Description, &p.Price, &p.ImageURL, &p.CreatedAt)

	c.JSON(http.StatusCreated, p)
}

func deleteProduct(c *gin.Context) {
	id := c.Param("id")

	var imageURL string
	db.QueryRow(context.Background(), "SELECT image_url FROM products WHERE id=$1", id).Scan(&imageURL)

	result, err := db.Exec(context.Background(), "DELETE FROM products WHERE id=$1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "商品が見つかりません"})
		return
	}

	if imageURL != "" {
		filename := filepath.Base(imageURL)
		os.Remove(filepath.Join("uploads", filename))
	}

	c.JSON(http.StatusOK, gin.H{"message": "削除しました"})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
