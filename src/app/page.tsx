"use client"
import { useEffect, useState } from "react"
import type React from "react"
import { supabase } from "../../lib/supabaseClient"
import { Plus, X, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import Image from "next/image"
import { v4 as uuidv4 } from "uuid"

interface Product {
  id: string
  name: string
  price: number | null
  description: string
  image_url: string
  created_at: string
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    image: null as File | null,
    imagePreview: "",
  })

  useEffect(() => {
    // 初回データ取得
    const fetchProducts = async () => {
      const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false })
      if (error) console.error("Error fetching products:", error)
      else setProducts(data)
    }

    fetchProducts()

    // リアルタイム更新を購読
    const subscription = supabase
      .channel("products")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        fetchProducts() // データを再取得して更新
      })
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setFormData({
        ...formData,
        image: file,
        imagePreview: URL.createObjectURL(file),
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      let imageUrl = ""

      // 画像がある場合はアップロード
      if (formData.image) {
        const fileExt = formData.image.name.split(".").pop()
        const fileName = `${uuidv4()}.${fileExt}`
        const filePath = `products/${fileName}`

        const { error: uploadError } = await supabase.storage.from("product-images").upload(filePath, formData.image)

        if (uploadError) throw uploadError

        // 画像のURLを取得
        const { data } = supabase.storage.from("product-images").getPublicUrl(filePath)
        if (data) {
          imageUrl = data.publicUrl
        }
      }

      // 商品データを保存
      const { error } = await supabase.from("products").insert([
        {
          name: formData.name,
          description: formData.description,
          image_url: imageUrl,
          price: null, // 価格は運営が設定するためnull
        },
      ])

      if (error) throw error

      // フォームをリセット
      setFormData({
        name: "",
        description: "",
        image: null,
        imagePreview: "",
      })

      setOpen(false)
    } catch (error) {
      console.error("Error adding product:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">バザー商品一覧</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-1">
              <Plus size={18} />
              <span>出品する</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>商品を出品する</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">商品名</Label>
                <Input id="name" name="name" value={formData.name} onChange={handleInputChange} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">商品説明</Label>
                <Textarea id="description" name="description" value={formData.description} onChange={handleInputChange} rows={3} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="image">商品画像</Label>
                <Input id="image" type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  キャンセル
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "送信中..." : "出品する"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.map((product) => (
          <Card key={product.id} className="overflow-hidden h-full flex flex-col">
            <div className="relative aspect-square">
              <Image src={product.image_url || "/placeholder.svg"} alt={product.name} fill className="object-cover" />
            </div>
            <CardContent className="pt-4 flex-grow">
              <h2 className="text-lg font-semibold">{product.name}</h2>
              <p className="text-sm text-gray-600 mt-1">{product.description}</p>
            </CardContent>
            <CardFooter className="border-t p-4">
              <p className="text-lg font-bold">{product.price !== null ? `${product.price.toLocaleString()}円` : "価格未定"}</p>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  )
}
