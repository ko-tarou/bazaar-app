"use client"
import { useEffect, useState, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import type React from "react"
import { Plus, X, Upload, Pencil, LayoutDashboard, Store, ChevronLeft, ChevronRight, Download } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import Image from "next/image"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080"
const PAGE_SIZE = 12

const CATEGORIES = ["すべて", "食べ物", "飲み物", "雑貨", "衣類", "本・ゲーム", "その他"]
const STATUS_LABELS: Record<string, string> = { available: "販売中", reserved: "取り置き中", sold: "売り切れ" }
const STATUS_VARIANTS: Record<string, "available" | "reserved" | "sold"> = {
  available: "available", reserved: "reserved", sold: "sold",
}

interface Product {
  id: string; name: string; price: number | null; description: string
  category: string; stock: number; status: string; image_url: string
  booth_id: string | null; booth_name: string; created_at: string
}
interface Booth { id: string; name: string }
type FormState = {
  name: string; description: string; price: string; category: string
  stock: string; booth_id: string; image: File | null; imagePreview: string
}
const defaultForm: FormState = {
  name: "", description: "", price: "", category: "その他", stock: "1", booth_id: "", image: null, imagePreview: "",
}

function HomeContent() {
  const searchParams = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [filterCategory, setFilterCategory] = useState("すべて")
  const [sort, setSort] = useState("newest")
  const [booths, setBooths] = useState<Booth[]>([])
  const [filterBooth, setFilterBooth] = useState(searchParams.get("booth_id") ?? "")
  const [formData, setFormData] = useState<FormState>(defaultForm)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const fetchProducts = useCallback(async () => {
    setFetching(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (filterCategory !== "すべて") params.set("category", filterCategory)
      if (filterBooth) params.set("booth_id", filterBooth)
      params.set("sort", sort)
      params.set("limit", String(PAGE_SIZE))
      params.set("offset", String(page * PAGE_SIZE))
      const res = await fetch(`${API_BASE}/api/products?${params}`)
      if (!res.ok) throw new Error("データの取得に失敗しました")
      const json = await res.json()
      setProducts(json.products ?? [])
      setTotal(json.total ?? 0)
    } catch (e) { setError((e as Error).message) }
    finally { setFetching(false) }
  }, [search, filterCategory, sort, filterBooth, page])

  useEffect(() => { fetchProducts() }, [fetchProducts])
  useEffect(() => {
    fetch(`${API_BASE}/api/booths`).then((r) => r.json()).then((d) => setBooths(d ?? []))
  }, [])
  useEffect(() => { setPage(0) }, [search, filterCategory, sort, filterBooth])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const openCreate = () => { setEditProduct(null); setFormData(defaultForm); setOpen(true) }
  const openEdit = (p: Product, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditProduct(p)
    setFormData({
      name: p.name, description: p.description,
      price: p.price !== null ? String(p.price) : "",
      category: p.category, stock: String(p.stock),
      booth_id: p.booth_id ?? "",
      image: null, imagePreview: p.image_url ? `${API_BASE}${p.image_url}` : "",
    })
    setOpen(true)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true)
    try {
      const body = new FormData()
      body.append("name", formData.name); body.append("description", formData.description)
      body.append("category", formData.category); body.append("stock", formData.stock)
      if (formData.price) body.append("price", formData.price)
      if (formData.booth_id) body.append("booth_id", formData.booth_id)
      if (formData.image) body.append("image", formData.image)

      const url = editProduct ? `${API_BASE}/api/products/${editProduct.id}` : `${API_BASE}/api/products`
      const res = await fetch(url, { method: editProduct ? "PUT" : "POST", body })
      if (!res.ok) throw new Error("保存に失敗しました")
      setOpen(false); fetchProducts()
      showToast(editProduct ? "商品を更新しました" : "商品を出品しました")
    } catch (err) { showToast((err as Error).message) }
    finally { setLoading(false) }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const res = await fetch(`${API_BASE}/api/products/${id}`, { method: "DELETE" })
    if (res.ok) { fetchProducts(); showToast("商品を削除しました") }
  }

  const handleStatusChange = async (id: string, status: string) => {
    const res = await fetch(`${API_BASE}/api/products/${id}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setDetailProduct((prev) => prev ? { ...prev, status } : null)
      fetchProducts()
      showToast(`ステータスを「${STATUS_LABELS[status]}」に変更しました`)
    }
  }

  return (
    <div className="container mx-auto px-4 py-6">
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-5 py-3 rounded-lg shadow-lg z-50 text-sm">
          {toast}
        </div>
      )}

      {/* ナビゲーション */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">バザー商品一覧</h1>
        <div className="flex gap-2">
          <Link href="/dashboard">
            <Button variant="outline" size="sm" className="flex gap-1"><LayoutDashboard size={16} />集計</Button>
          </Link>
          <Link href="/booths">
            <Button variant="outline" size="sm" className="flex gap-1"><Store size={16} />ブース</Button>
          </Link>
          <Button
            variant="outline" size="sm"
            className="flex gap-1"
            onClick={() => window.open(`${API_BASE}/api/products/export`, "_blank")}
          >
            <Download size={16} />CSV
          </Button>
          <Button className="flex items-center gap-1" onClick={openCreate}>
            <Plus size={18} /><span>出品する</span>
          </Button>
        </div>
      </div>

      {/* フィルター */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Input className="max-w-xs" placeholder="商品名・説明で検索" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="border rounded-md px-3 py-2 text-sm bg-white" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="border rounded-md px-3 py-2 text-sm bg-white" value={filterBooth} onChange={(e) => setFilterBooth(e.target.value)}>
          <option value="">すべてのブース</option>
          {booths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="border rounded-md px-3 py-2 text-sm bg-white" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">新着順</option>
          <option value="price_asc">価格が安い順</option>
          <option value="price_desc">価格が高い順</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {error}<Button variant="outline" size="sm" className="ml-3" onClick={fetchProducts}>再試行</Button>
        </div>
      )}

      {/* 商品グリッド */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {fetching
          ? Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="aspect-square w-full" />
                <CardContent className="pt-4"><Skeleton className="h-5 w-3/4 mb-2" /><Skeleton className="h-4 w-full" /></CardContent>
                <CardFooter className="border-t p-4"><Skeleton className="h-6 w-24" /></CardFooter>
              </Card>
            ))
          : products.map((product) => (
              <Card key={product.id} className="overflow-hidden h-full flex flex-col cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDetailProduct(product)}>
                <div className="relative aspect-square bg-gray-100">
                  <Image
                    src={product.image_url ? `${API_BASE}${product.image_url}` : "/placeholder.svg"}
                    alt={product.name} fill
                    className={`object-cover ${product.status === "sold" ? "opacity-50" : ""}`}
                  />
                  <span className="absolute top-2 left-2 bg-white/80 text-xs px-2 py-0.5 rounded-full">{product.category}</span>
                  <Badge variant={STATUS_VARIANTS[product.status] ?? "available"} className="absolute top-2 right-2">
                    {STATUS_LABELS[product.status]}
                  </Badge>
                </div>
                <CardContent className="pt-4 flex-grow">
                  <h2 className="text-lg font-semibold">{product.name}</h2>
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">{product.description}</p>
                  {product.booth_name && <p className="text-xs text-blue-500 mt-1">📍 {product.booth_name}</p>}
                  <p className="text-xs text-gray-500 mt-1">在庫: {product.stock}個</p>
                </CardContent>
                <CardFooter className="border-t p-4 flex justify-between items-center">
                  <p className="text-lg font-bold">{product.price !== null ? `${product.price.toLocaleString()}円` : "価格未定"}</p>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={(e) => openEdit(product, e)}><Pencil size={14} /></Button>
                    <Button variant="destructive" size="sm" onClick={(e) => handleDelete(product.id, e)}><X size={14} /></Button>
                  </div>
                </CardFooter>
              </Card>
            ))}
      </div>

      {/* ページネーション */}
      {!fetching && totalPages > 1 && (
        <div className="flex justify-center items-center gap-3 mt-8">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={16} />
          </Button>
          <span className="text-sm text-gray-600">{page + 1} / {totalPages}ページ（{total}件）</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight size={16} />
          </Button>
        </div>
      )}

      {/* 商品詳細モーダル */}
      <Dialog open={!!detailProduct} onOpenChange={(v) => !v && setDetailProduct(null)}>
        <DialogTrigger asChild><span /></DialogTrigger>
        {detailProduct && (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{detailProduct.name}</DialogTitle></DialogHeader>
            <div className="relative aspect-video w-full bg-gray-100 rounded-md overflow-hidden">
              <Image src={detailProduct.image_url ? `${API_BASE}${detailProduct.image_url}` : "/placeholder.svg"} alt={detailProduct.name} fill className="object-contain" />
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex gap-2 items-center">
                <Badge variant={STATUS_VARIANTS[detailProduct.status] ?? "available"}>{STATUS_LABELS[detailProduct.status]}</Badge>
                <span className="text-gray-500">{detailProduct.category}</span>
                {detailProduct.booth_name && <span className="text-blue-500">📍 {detailProduct.booth_name}</span>}
              </div>
              <p className="text-gray-700">{detailProduct.description}</p>
              <div className="flex justify-between items-center">
                <p className="text-2xl font-bold">{detailProduct.price !== null ? `${detailProduct.price.toLocaleString()}円` : "価格未定"}</p>
                <p className="text-gray-500">在庫: {detailProduct.stock}個</p>
              </div>
              <div className="flex gap-2 pt-2 flex-wrap">
                <span className="text-gray-500 self-center text-xs">ステータス変更:</span>
                {["available", "reserved", "sold"].map((s) => (
                  <Button key={s} size="sm" variant={detailProduct.status === s ? "default" : "outline"} onClick={() => handleStatusChange(detailProduct.id, s)}>
                    {STATUS_LABELS[s]}
                  </Button>
                ))}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* 出品・編集ダイアログ */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editProduct ? "商品を編集する" : "商品を出品する"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">商品名</Label>
              <Input id="name" name="name" value={formData.name} onChange={handleInputChange} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">商品説明</Label>
              <Textarea id="description" name="description" value={formData.description} onChange={handleInputChange} rows={3} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="price">価格（円）</Label>
                <Input id="price" name="price" type="number" min="0" value={formData.price} onChange={handleInputChange} placeholder="価格未定" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stock">在庫数</Label>
                <Input id="stock" name="stock" type="number" min="0" value={formData.stock} onChange={handleInputChange} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>カテゴリ</Label>
                <select name="category" value={formData.category} onChange={handleInputChange} className="w-full border rounded-md px-3 py-2 text-sm bg-white">
                  {CATEGORIES.filter((c) => c !== "すべて").map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label>ブース</Label>
                <select name="booth_id" value={formData.booth_id} onChange={handleInputChange} className="w-full border rounded-md px-3 py-2 text-sm bg-white">
                  <option value="">未設定</option>
                  {booths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>商品画像</Label>
              <div className="flex flex-col items-center gap-4">
                {formData.imagePreview ? (
                  <div className="relative w-full h-48 border border-gray-300 rounded-md">
                    <Image src={formData.imagePreview} alt="プレビュー" fill className="object-cover rounded-md" />
                    <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2" onClick={() => setFormData((p) => ({ ...p, image: null, imagePreview: "" }))}>
                      <X size={16} />
                    </Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                    <Upload className="w-8 h-8 mb-2 text-gray-500" />
                    <p className="text-sm text-gray-500">クリックして画像をアップロード</p>
                    <Input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      if (e.target.files?.[0]) {
                        const f = e.target.files[0]
                        setFormData((p) => ({ ...p, image: f, imagePreview: URL.createObjectURL(f) }))
                      }
                    }} />
                  </label>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
              <Button type="submit" disabled={loading}>{loading ? "保存中..." : editProduct ? "更新する" : "出品する"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  )
}
