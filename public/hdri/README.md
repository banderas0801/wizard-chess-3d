# Poly Haven CC0 HDRI Environment

Thư mục này dùng để chứa tệp HDRI môi trường ánh sáng giáo đường hoặc phòng đá cổ.

## Cách tải HDRI CC0 (Poly Haven):

1. Truy cập: [Poly Haven HDRIs](https://polyhaven.com/hdris) (hoặc danh mục *Indoor / Historic*).
2. Gợi ý bản phù hợp nhất với chủ đề Gothic:
   - **`cathedral_atrium_1k.hdr`** (hoặc `monastery_stone_hall_1k.hdr`).
3. Chọn định dạng:
   - **Resolution:** `1k` (Đủ chi tiết phản xạ, tối ưu nhẹ ~300KB - 500KB).
   - **Format:** `.hdr` (hoặc `.exr`).
4. Đặt tệp tải về vào thư mục này với tên:
   ```
   public/hdri/cathedral_atrium_1k.hdr
   ```
5. Ứng dụng sẽ tự động tải tệp này qua `RGBELoader` và chạy qua `PMREMGenerator` đúng 1 lần khi khởi động.
