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
    origin: ['http://localhost:3000'],
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
    // Database কানেক্ট করা
    await client.connect();
    db = client.db('agroVision_db');

    const productsCollection = db.collection('products');
    const likesCollection = db.collection('likes');
    const commentsCollection = db.collection('comments');
    const usersCollection = db.collection('user');

    console.log('✅ AGROVISION DB: CONNECTED AND SYNCHRONIZED');

    /**
     * A. PRODUCT MANAGEMENT ROUTES
     */

    // A1. Add New Product
    app.post('/api/products/add', async (req: Request, res: Response) => {
      try {
        const productData = {
          ...req.body,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        const result = await productsCollection.insertOne(productData);
        res.status(201).send({ success: true, insertedId: result.insertedId });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // A2. Get Products for specific user (Pagination)
    app.get('/api/my-products/:userId', async (req: Request, res: Response) => {
      try {
        const userId = req.params.userId as string;
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
        });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // A3. Delete Product (FIXED TYPE ERROR)
    app.delete('/api/products/:id', async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string; // Explicit cast to string

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

    // A4. Update Product (FIXED TYPE ERROR)
    app.patch('/api/products/:id', async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string; // Explicit cast to string

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .send({ success: false, message: 'Invalid ID format' });
        }

        const updatedData = req.body;
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

    // A5. Marketplace All Products (Fixed Search & Status)
    app.get('/api/products/all', async (req: Request, res: Response) => {
      try {
        const { search, type, category, page } = req.query;
        const pageNum = parseInt(page as string) || 1;
        const limit = 8;
        const skip = (pageNum - 1) * limit;

        let query: any = { status: { $in: ['active', 'pending'] } };

        if (type && type !== 'All') query.productType = type;
        if (category && category !== 'All')
          query.category = { $regex: `^${category}$`, $options: 'i' };
        if (search) query.title = { $regex: search as string, $options: 'i' };

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
        res.status(500).send({ error: error.message });
      }
    });

    // A6. Single Product Detail (uses REAL data: specifications, seller, reviews)
    app.get('/api/products/:id', async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ error: 'Invalid ID' });

        const product: any = await productsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!product) return res.status(404).send({ error: 'Not found' });

        // --- 1) SPECIFICATIONS: build from the actual fields saved on the product ---
        const specFieldMap: Record<string, string> = {
          brand: 'Brand',
          model: 'Model',
          weight: 'Weight',
          powerSource: 'Power Source',
          categoryType: 'Category Type',
          warranty: 'Warranty',
          deliveryInfo: 'Delivery Info',
          certification: 'Certification',
          shippingPolicy: 'Shipping Policy',
          returnPolicy: 'Return Policy',
          installationSupport: 'Installation Support',
          unit: 'Unit',
        };
        const specifications: Record<string, string> = {};
        Object.entries(specFieldMap).forEach(([key, label]) => {
          const value = product[key];
          if (value !== undefined && value !== null && value !== '') {
            specifications[label] =
              typeof value === 'boolean'
                ? value
                  ? 'Yes'
                  : 'No'
                : String(value);
          }
        });

        // --- 2) SELLER: prefer the real user who created the product ---
        let sellerUser: any = null;
        if (product.userId) {
          sellerUser = await usersCollection.findOne(
            ObjectId.isValid(product.userId)
              ? { _id: new ObjectId(product.userId) }
              : { _id: product.userId },
          );
        }
        const seller = {
          name: sellerUser?.name || product.sellerName || 'AgroVision Seller',
          image: sellerUser?.image || product.sellerImage || null,
          email: sellerUser?.email || null,
          rating: product.sellerRating || 4.8,
          responseTime: product.sellerResponseTime || '< 3 hours',
          verified: true,
        };

        // --- 3) REVIEWS: real comments left on this product ---
        const productComments = await commentsCollection
          .find({ productId: id })
          .sort({ createdAt: -1 })
          .toArray();
        const reviews = productComments.map((c: any) => ({
          id: c._id.toString(),
          user: c.userName,
          rating: c.rating || product.rating || 5,
          comment: c.comment,
          date: c.createdAt,
          verified: true,
        }));

        // --- 4) AI INSIGHTS: from real fields, sensible defaults otherwise ---
        const aiInsights = {
          roiEstimation: product.roiEstimation || 'N/A',
          maintenance: product.maintenance || 'N/A',
          bestSeason: product.bestSeason || 'Year Round',
        };

        res.send({
          success: true,
          product: {
            ...product,
            specifications,
            seller,
            aiInsights,
            reviews: reviews.length, // review count for the header stars
          },
          reviews,
        });
      } catch (error: any) {
        res.status(500).send({ error: error.message });
      }
    });

    /**
     * B. LIKES & COMMENTS
     */

    app.post('/api/likes/toggle', async (req: Request, res: Response) => {
      try {
        const { productId, userName } = req.body;
        const existing = await likesCollection.findOne({ productId });

        if (!existing) {
          await likesCollection.insertOne({ productId, likedBy: [userName] });
          return res.send({ success: true, liked: true, likesCount: 1 });
        }

        const alreadyLiked = existing.likedBy.includes(userName);
        if (alreadyLiked) {
          await likesCollection.updateOne(
            { productId },
            { $pull: { likedBy: userName } },
          );
          res.send({
            success: true,
            liked: false,
            likesCount: existing.likedBy.length - 1,
          });
        } else {
          await likesCollection.updateOne(
            { productId },
            { $push: { likedBy: userName } },
          );
          res.send({
            success: true,
            liked: true,
            likesCount: existing.likedBy.length + 1,
          });
        }
      } catch (error: any) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get('/api/likes/:productId', async (req: Request, res: Response) => {
      const doc = await likesCollection.findOne({
        productId: req.params.productId,
      });
      const likedBy = doc?.likedBy || [];
      res.send({
        likesCount: likedBy.length,
        isLiked: req.query.userName
          ? likedBy.includes(req.query.userName)
          : false,
      });
    });

    app.post('/api/comments/add', async (req: Request, res: Response) => {
      const { productId, userId, userName, userImage, comment } = req.body;
      const commentData = {
        productId,
        userId,
        userName,
        userImage,
        comment: comment.trim(),
        createdAt: new Date(),
      };
      const result = await commentsCollection.insertOne(commentData);
      res.status(201).send({
        success: true,
        comment: { _id: result.insertedId, ...commentData },
      });
    });

    app.get('/api/comments/:productId', async (req: Request, res: Response) => {
      const comments = await commentsCollection
        .find({ productId: req.params.productId })
        .sort({ createdAt: -1 })
        .toArray();
      res.send({ success: true, comments });
    });

    app.delete('/api/comments/:id', async (req: Request, res: Response) => {
      const id = req.params.id as string;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ error: 'Invalid ID' });
      await commentsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ success: true, message: 'Comment deleted' });
    });
  } catch (error) {
    console.error('❌ DATABASE ERROR:', error);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => res.send('🌾 AgroVision API is Live'));
app.listen(port, () => console.log(`🚀 Server: http://localhost:${port}`));
