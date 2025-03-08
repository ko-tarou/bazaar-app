"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  image_url: string;
  created_at: string;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    // 初回データ取得
    const fetchProducts = async () => {
      const { data, error } = await supabase.from("products").select("*");
      if (error) console.error("Error fetching products:", error);
      else {
        console.log("Fetched products:", data); 
        setProducts(data)
      };
    };

    fetchProducts();

    // リアルタイム更新を購読
    const subscription = supabase
      .channel("products")
      .on(
        "postgres_changes", 
        { event: "*", schema: "public", table: "products" }, 
        (payload) => {
          console.log("Received change:", payload);
          fetchProducts(); // データを再取得して更新
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">商品一覧（リアルタイム更新）</h1>
      <div className="grid grid-cols-3 gap-4">
        {products.map((product) => (
          <div key={product.id} className="border p-4">
            <h2 className="text-lg font-semibold">{product.name}</h2>
            <p>{product.price}円</p>
            <p className="text-sm text-gray-600">{product.description}</p>
            {product.image_url && (
              <img src={product.image_url} alt={product.name} className="mt-2 w-full h-32 object-cover" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
