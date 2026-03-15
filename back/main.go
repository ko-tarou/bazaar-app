package main

import (
	"context"
	"encoding/csv"
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
	Category    string    `json:"category"`
	Stock       int       `json:"stock"`
	Status      string    `json:"status"`
	ImageURL    string    `json:"image_url"`
	BoothID     *string   `json:"booth_id"`
	BoothName   string    `json:"booth_name,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type Booth struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type DashboardStats struct {
	TotalProducts  int `json:"total_products"`
	TotalSold      int `json:"total_sold"`
	TotalReserved  int `json:"total_reserved"`
	TotalAvailable int `json:"total_available"`
	TotalRevenue   int `json:"total_revenue"`
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
		api.GET("/products/export", exportProductsCSV)
		api.POST("/products", createProduct)
		api.PUT("/products/:id", updateProduct)
		api.PATCH("/products/:id/status", patchProductStatus)
		api.DELETE("/products/:id", deleteProduct)

		api.GET("/booths", getBooths)
		api.POST("/booths", createBooth)
		api.DELETE("/booths/:id", deleteBooth)

		api.GET("/dashboard", getDashboard)
	}

	port := getEnv("PORT", "8080")
	log.Printf("サーバー起動: http://localhost:%s", port)
	r.Run(":" + port)
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "http://localhost:3000")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func getProducts(c *gin.Context) {
	category := c.Query("category")
	search := c.Query("search")
	sortOrder := c.Query("sort")
	boothID := c.Query("booth_id")
	limitStr := c.DefaultQuery("limit", "20")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	query := `SELECT p.id, p.name, p.description, p.price, p.category, p.stock, p.status,
	                 p.image_url, p.booth_id, COALESCE(b.name,'') as booth_name, p.created_at
	          FROM products p LEFT JOIN booths b ON p.booth_id = b.id WHERE 1=1`
	args := []any{}
	idx := 1

	if category != "" && category != "すべて" {
		query += fmt.Sprintf(" AND p.category=$%d", idx)
		args = append(args, category)
		idx++
	}
	if search != "" {
		query += fmt.Sprintf(" AND (p.name ILIKE $%d OR p.description ILIKE $%d)", idx, idx)
		args = append(args, "%"+search+"%")
		idx++
	}
	if boothID != "" {
		query += fmt.Sprintf(" AND p.booth_id=$%d", idx)
		args = append(args, boothID)
		idx++
	}

	switch sortOrder {
	case "price_asc":
		query += " ORDER BY p.price ASC NULLS LAST"
	case "price_desc":
		query += " ORDER BY p.price DESC NULLS LAST"
	default:
		query += " ORDER BY p.created_at DESC"
	}

	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", idx, idx+1)
	args = append(args, limit, offset)

	rows, err := db.Query(context.Background(), query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	products := []Product{}
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Price, &p.Category, &p.Stock, &p.Status,
			&p.ImageURL, &p.BoothID, &p.BoothName, &p.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		products = append(products, p)
	}

	// 総件数を取得
	countQuery := `SELECT COUNT(*) FROM products p WHERE 1=1`
	countArgs := args[:len(args)-2] // limit/offset を除く
	var total int
	db.QueryRow(context.Background(), countQuery, countArgs...).Scan(&total)

	c.JSON(http.StatusOK, gin.H{"products": products, "total": total, "limit": limit, "offset": offset})
}

func exportProductsCSV(c *gin.Context) {
	rows, err := db.Query(context.Background(),
		`SELECT p.id, p.name, p.description, COALESCE(p.price::text,''), p.category, p.stock, p.status,
		        COALESCE(b.name,'') as booth_name, p.created_at
		 FROM products p LEFT JOIN booths b ON p.booth_id=b.id ORDER BY p.created_at DESC`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=products.csv")

	w := csv.NewWriter(c.Writer)
	// BOM for Excel
	c.Writer.Write([]byte("\xef\xbb\xbf"))
	w.Write([]string{"ID", "商品名", "説明", "価格", "カテゴリ", "在庫", "ステータス", "ブース", "登録日時"})

	for rows.Next() {
		var id, name, desc, price, category, status, booth string
		var stock int
		var createdAt time.Time
		rows.Scan(&id, &name, &desc, &price, &category, &stock, &status, &booth, &createdAt)
		w.Write([]string{id, name, desc, price, category, strconv.Itoa(stock), status, booth, createdAt.Format("2006-01-02 15:04:05")})
	}
	w.Flush()
}

func createProduct(c *gin.Context) {
	name := c.PostForm("name")
	description := c.PostForm("description")
	priceStr := c.PostForm("price")
	category := c.PostForm("category")
	stockStr := c.PostForm("stock")
	boothID := c.PostForm("booth_id")

	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name は必須です"})
		return
	}
	if category == "" {
		category = "その他"
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

	stock := 1
	if stockStr != "" {
		s, err := strconv.Atoi(stockStr)
		if err == nil && s >= 0 {
			stock = s
		}
	}

	var boothIDPtr *string
	if boothID != "" {
		boothIDPtr = &boothID
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
		`INSERT INTO products (name, description, price, category, stock, image_url, booth_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		name, description, price, category, stock, imageURL, boothIDPtr,
	).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var p Product
	db.QueryRow(context.Background(),
		`SELECT p.id, p.name, p.description, p.price, p.category, p.stock, p.status,
		        p.image_url, p.booth_id, COALESCE(b.name,''), p.created_at
		 FROM products p LEFT JOIN booths b ON p.booth_id=b.id WHERE p.id=$1`, id,
	).Scan(&p.ID, &p.Name, &p.Description, &p.Price, &p.Category, &p.Stock, &p.Status,
		&p.ImageURL, &p.BoothID, &p.BoothName, &p.CreatedAt)

	c.JSON(http.StatusCreated, p)
}

func updateProduct(c *gin.Context) {
	id := c.Param("id")
	name := c.PostForm("name")
	description := c.PostForm("description")
	priceStr := c.PostForm("price")
	category := c.PostForm("category")
	stockStr := c.PostForm("stock")
	boothID := c.PostForm("booth_id")

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

	stock := 1
	if stockStr != "" {
		s, err := strconv.Atoi(stockStr)
		if err == nil && s >= 0 {
			stock = s
		}
	}

	var boothIDPtr *string
	if boothID != "" {
		boothIDPtr = &boothID
	}

	var imageURL string
	db.QueryRow(context.Background(), "SELECT image_url FROM products WHERE id=$1", id).Scan(&imageURL)

	file, err := c.FormFile("image")
	if err == nil {
		if imageURL != "" {
			os.Remove(filepath.Join("uploads", filepath.Base(imageURL)))
		}
		ext := filepath.Ext(file.Filename)
		filename := fmt.Sprintf("%s%s", uuid.New().String(), ext)
		savePath := filepath.Join("uploads", filename)
		if err := c.SaveUploadedFile(file, savePath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "画像保存失敗"})
			return
		}
		imageURL = "/uploads/" + filename
	}

	_, err = db.Exec(context.Background(),
		`UPDATE products SET name=$1, description=$2, price=$3, category=$4, stock=$5, image_url=$6, booth_id=$7 WHERE id=$8`,
		name, description, price, category, stock, imageURL, boothIDPtr, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var p Product
	db.QueryRow(context.Background(),
		`SELECT p.id, p.name, p.description, p.price, p.category, p.stock, p.status,
		        p.image_url, p.booth_id, COALESCE(b.name,''), p.created_at
		 FROM products p LEFT JOIN booths b ON p.booth_id=b.id WHERE p.id=$1`, id,
	).Scan(&p.ID, &p.Name, &p.Description, &p.Price, &p.Category, &p.Stock, &p.Status,
		&p.ImageURL, &p.BoothID, &p.BoothName, &p.CreatedAt)

	c.JSON(http.StatusOK, p)
}

func patchProductStatus(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.Status != "available" && body.Status != "reserved" && body.Status != "sold" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status は available / reserved / sold のいずれかです"})
		return
	}
	result, err := db.Exec(context.Background(),
		`UPDATE products SET status=$1 WHERE id=$2`, body.Status, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "商品が見つかりません"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": body.Status})
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
		os.Remove(filepath.Join("uploads", filepath.Base(imageURL)))
	}

	c.JSON(http.StatusOK, gin.H{"message": "削除しました"})
}

// ===== ブース =====

func getBooths(c *gin.Context) {
	rows, err := db.Query(context.Background(),
		`SELECT id, name, description, created_at FROM booths ORDER BY created_at DESC`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	booths := []Booth{}
	for rows.Next() {
		var b Booth
		rows.Scan(&b.ID, &b.Name, &b.Description, &b.CreatedAt)
		booths = append(booths, b)
	}
	c.JSON(http.StatusOK, booths)
}

func createBooth(c *gin.Context) {
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name は必須です"})
		return
	}
	var b Booth
	err := db.QueryRow(context.Background(),
		`INSERT INTO booths (name, description) VALUES ($1, $2)
		 RETURNING id, name, description, created_at`,
		body.Name, body.Description,
	).Scan(&b.ID, &b.Name, &b.Description, &b.CreatedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, b)
}

func deleteBooth(c *gin.Context) {
	id := c.Param("id")
	result, err := db.Exec(context.Background(), "DELETE FROM booths WHERE id=$1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "ブースが見つかりません"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "削除しました"})
}

// ===== ダッシュボード =====

func getDashboard(c *gin.Context) {
	var stats DashboardStats
	db.QueryRow(context.Background(), `
		SELECT
		  COUNT(*) as total,
		  COUNT(*) FILTER (WHERE status='sold') as sold,
		  COUNT(*) FILTER (WHERE status='reserved') as reserved,
		  COUNT(*) FILTER (WHERE status='available') as available,
		  COALESCE(SUM(price) FILTER (WHERE status='sold'), 0) as revenue
		FROM products
	`).Scan(&stats.TotalProducts, &stats.TotalSold, &stats.TotalReserved, &stats.TotalAvailable, &stats.TotalRevenue)

	c.JSON(http.StatusOK, stats)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
