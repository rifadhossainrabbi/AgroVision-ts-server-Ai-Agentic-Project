import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';

// --- 1. INITIAL CONFIGURATIONS ---
dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// --- 2. MIDDLEWARES ---
app.use(
  cors({
    origin: ['http://localhost:3000'], // ফ্রন্টএন্ডের পোর্ট ৩০০০ অ্যালাউ করা হলো
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' })); // বড় ডাটা বা ইমেজের জন্য লিমিট বাড়ানো হলো

// --- 3. DATABASE CONNECTION ---
const uri = process.env.MONGODB_URI as string;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // ডাটাবেস কানেক্ট করা
    const db = client.db('agroVision_db');
    const productsCollection = db.collection('products');

    console.log('✅ AGROVISION DB: CONNECTED AND SYNCHRONIZED');

    /**
     * PRODUCT MANAGEMENT ROUTES
     */

    // A1. Add Product (সরাসরি রুট, কোনো টোকেন ভেরিফিকেশন নেই)
    app.post('/api/products/add', async (req: Request, res: Response) => {
      try {
        const productData = {
          ...req.body,
          status: 'pending', // ডিফল্ট স্ট্যাটাস পেন্ডিং থাকবে (অ্যাডমিন অ্যাপ্রুভালের জন্য)
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await productsCollection.insertOne(productData);

        console.log(`📦 New product added: ${req.body.title}`);

        res.status(201).send({
          success: true,
          message: 'Product added successfully!',
          insertedId: result.insertedId,
        });
      } catch (error: any) {
        console.error('Insert Error:', error);
        res.status(500).send({
          success: false,
          error: error.message || 'Failed to save product',
        });
      }
    });

    // A2. Get Products with Pagination (User Specific)
    app.get('/api/my-products/:userId', async (req: Request, res: Response) => {
      try {
        const userId = req.params.userId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = 5; // প্রতি পেজে ৫টি প্রোডাক্ট
        const skip = (page - 1) * limit;

        const query = { userId };
        const products = await productsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const total = await productsCollection.countDocuments(query);

        res.send({
          success: true,
          products,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          totalItems: total,
        });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // A3. Delete Product
    app.delete('/api/products/:id', async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const result = await productsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send({ success: true, message: 'Deleted successfully', result });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // A4. Update Product (Basic)
    app.patch('/api/products/:id', async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const updatedData = req.body;
        const result = await productsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData },
        );
        res.send({ success: true, message: 'Updated successfully', result });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });
  } catch (error) {
    console.error('❌ DATABASE CONNECTION ERROR:', error);
  }
}

// রান ফাংশনটি কল করা
run().catch(console.dir);

// মেইন ইউআরএল টেস্ট
app.get('/', (req, res) => {
  res.send('🌾 AgroVision Master Server is Active (Port 5000)');
});

// সার্ভার লিসেন
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
