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
    origin: ['http://localhost:3000'], // আপনার ফ্রন্টএন্ড পোর্ট
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));

// --- 3. DATABASE CONNECTION ---
const uri = process.env.MONGODB_URI as string;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db: any;

async function run() {
  try {
    // ডাটাবেস কানেক্ট করা
    db = client.db('agroVision_db');
    const productsCollection = db.collection('products');

    console.log('✅ AGROVISION DB: CONNECTED AND SYNCHRONIZED');

    /**
     * PRODUCT MANAGEMENT ROUTES
     */

    // A1. Add New Product
    app.post('/api/products/add', async (req: Request, res: Response) => {
      try {
        const productData = {
          ...req.body,
          status: 'active', // ডিফল্ট স্ট্যাটাস
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await productsCollection.insertOne(productData);
        res.status(201).send({
          success: true,
          message: 'Product added successfully!',
          insertedId: result.insertedId,
        });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // A2. Get Products for specific user (With Pagination)
    app.get('/api/my-products/:userId', async (req: Request, res: Response) => {
      try {
        const userId = req.params.userId;
        const page = parseInt(req.query.page as string) || 1;
        const limit = 5;
        const skip = (page - 1) * limit;

        const query = { userId: userId };
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

    // A3. Delete Product (Fixing the ObjectId Error)
    app.delete('/api/products/:id', async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string; // 'as string' যোগ করা হয়েছে এরর ফিক্স করতে

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ success: false, message: 'Invalid ID format' });
        }

        const result = await productsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send({ success: true, message: 'Deleted successfully', result });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // A4. Update Product (Fixing the ObjectId Error)
    app.patch('/api/products/:id', async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string; // 'as string' যোগ করা হয়েছে এরর ফিক্স করতে

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ success: false, message: 'Invalid ID format' });
        }

        const updatedData = req.body;
        // আইডি কখনো আপডেট করা যায় না, তাই এটি বাদ দেওয়া নিরাপদ
        delete updatedData._id;

        const result = await productsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { ...updatedData, updatedAt: new Date() } },
        );

        res.send({ success: true, message: 'Updated successfully', result });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // ... আগের ইমপোর্টগুলো থাকবে

    // A5. Get All Products (Public Marketplace with Search, Filter & Pagination)
    // A5. Get All Products (Fixed Case-Insensitive Filter & Search)
    app.get('/api/products/all', async (req: Request, res: Response) => {
      try {
        const { search, type, category, page } = req.query;
        const pageNum = parseInt(page as string) || 1;
        const limit = 8;
        const skip = (pageNum - 1) * limit;

        let query: any = { status: 'active' };

        // ১. প্রোডাক্ট টাইপ (Crop/Machine)
        if (type && type !== 'All') {
          query.productType = type;
        }

        // ২. ক্যাটাগরি ফিল্টার (Case-Insensitive Fix)
        if (category && category !== 'All') {
          // এটি ডাটাবেসে Vegetables বা VEGETABLES যাই থাকুক তা খুঁজে বের করবে
          query.category = { $regex: `^${category}$`, $options: 'i' };
        }

        // ৩. সার্চ লজিক (প্রোডাক্ট টাইটেল অনুযায়ী)
        if (search) {
          query.title = { $regex: search, $options: 'i' };
        }

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
          currentPage: pageNum,
        });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });
  } catch (error) {
    console.error('❌ DATABASE ERROR:', error);
  }
}

// রান ফাংশনটি কল করা
run().catch(console.dir);

// হেলথ চেক রুট
app.get('/', (req, res) => {
  res.send('🌾 AgroVision Master Server is Active (Port 5000)');
});

// সার্ভার লিসেন
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
