import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- 1. INITIAL CONFIGURATIONS ---
dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// --- 1B. AI CONFIGURATION & HELPER ---
// Powers the two Agentic AI features: (1) AI Content Generator and (2) AI Chat Assistant.
async function generateTextWithAI(prompt: string): Promise<string> {
  const grokApiKey = process.env.GROK_API_KEY;
  if (grokApiKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grokApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    });
    const data: any = await res.json();
    if (data.choices && data.choices[0]?.message?.content) {
      return data.choices[0].message.content.trim();
    }
    if (data.error?.message) {
      throw new Error(`Groq API Error: ${data.error.message}`);
    }
  }

  const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (googleApiKey) {
    const genAI = new GoogleGenerativeAI(googleApiKey);
    const aiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await aiModel.generateContent(prompt);
    return result.response.text().trim();
  }

  throw new Error(
    'No valid AI API key found. Please set GROK_API_KEY or GOOGLE_API_KEY in agro-vision-server-ts/.env',
  );
}

// --- 1C. VISION AI HELPER (image + text -> text) ---
// Powers the AI Crop Doctor feature. Tries Groq's vision-capable model first
// (qwen/qwen3.6-27b — Groq's Llama 4 Scout/Maverick vision models were
// deprecated in 2026), and falls back to Gemini if no Groq key is set.
async function analyzeImageWithAI(
  prompt: string,
  base64Image: string,
  mimeType: string,
): Promise<string> {
  const grokApiKey = process.env.GROK_API_KEY;
  if (grokApiKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grokApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });
    const data: any = await res.json();
    if (data.choices && data.choices[0]?.message?.content) {
      return data.choices[0].message.content.trim();
    }
    if (data.error?.message) {
      throw new Error(`Groq Vision API Error: ${data.error.message}`);
    }
  }

  const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (googleApiKey) {
    const genAI = new GoogleGenerativeAI(googleApiKey);
    const aiModel = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });
    const result = await aiModel.generateContent([
      { text: prompt },
      { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Image } },
    ]);
    return result.response.text().trim();
  }

  throw new Error(
    'No valid AI API key found for image analysis. Please set GROK_API_KEY (vision-capable) or GOOGLE_API_KEY / GEMINI_API_KEY in agro-vision-server-ts/.env',
  );
}

// --- 1D. STRUCTURED JSON AI HELPER (text -> JSON) ---
// Powers the AI Farm Analyzer feature.
async function generateJSONWithAI(prompt: string): Promise<string> {
  const grokApiKey = process.env.GROK_API_KEY;
  if (grokApiKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grokApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });
    const data: any = await res.json();
    if (data.choices && data.choices[0]?.message?.content) {
      return data.choices[0].message.content.trim();
    }
    if (data.error?.message) {
      throw new Error(`Groq API Error: ${data.error.message}`);
    }
  }

  const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (googleApiKey) {
    const genAI = new GoogleGenerativeAI(googleApiKey);
    const aiModel = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });
    const result = await aiModel.generateContent(prompt);
    return result.response.text().trim();
  }

  throw new Error(
    'No valid AI API key found. Please set GROK_API_KEY or GOOGLE_API_KEY in agro-vision-server-ts/.env',
  );
}

// --- 1E. Safe JSON parser (strips markdown fences if the model adds them) ---
function safeParseAIJson(raw: string): any {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text
      .replace(/^```(json)?/i, '')
      .replace(/```$/, '')
      .trim();
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    text = text.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(text);
}

// --- 2. MIDDLEWARES ---
app.use(
  cors({
    origin: [process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'],
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'agro-vision-server-ts',
    timestamp: new Date().toISOString(),
  });
});

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
    const buyRequestsCollection = db.collection('buyRequests');
    const cartCollection = db.collection('cart');
    const diagnosesCollection = db.collection('diagnoses');
    const farmAnalysesCollection = db.collection('farmAnalyses');
    // better-auth (running on the Next.js app) writes its sessions into this
    // same MongoDB database — we verify tokens by looking them up here rather
    // than maintaining a separate JWT scheme.
    const sessionCollection = db.collection('session');

    console.log('✅ AGROVISION DB: CONNECTED AND SYNCHRONIZED');

    /**
     * AUTH MIDDLEWARE
     * Client sends the better-auth session token as: Authorization: Bearer <token>
     * verifyToken checks it against the `session` collection and attaches
     * req.userId. verifyAdmin (used after verifyToken) additionally checks
     * that the user's role is 'admin'.
     */
    async function verifyToken(
      req: Request,
      res: Response,
      next: NextFunction,
    ) {
      try {
        const authHeader = req.headers.authorization;
        console.log(authHeader, 'header');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res
            .status(401)
            .send({ success: false, error: 'Unauthorized: no token provided' });
        }

        const token = authHeader.split(' ')[1];
        console.log(token, 'token');
        const session = await sessionCollection.findOne({ token });

        if (!session) {
          return res
            .status(401)
            .send({ success: false, error: 'Unauthorized: invalid session' });
        }

        if (new Date(session.expiresAt).getTime() < Date.now()) {
          return res
            .status(401)
            .send({ success: false, error: 'Unauthorized: session expired' });
        }

        (req as any).userId = session.userId?.toString();
        next();
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    }

    async function verifyAdmin(
      req: Request,
      res: Response,
      next: NextFunction,
    ) {
      try {
        const userId = (req as any).userId;
        const user = await usersCollection.findOne({
          _id: new ObjectId(userId),
        });

        if (!user || user.role !== 'admin') {
          return res.status(403).send({
            success: false,
            error: 'Forbidden: admin access required',
          });
        }

        next();
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    }

    /**
     * A. PRODUCT MANAGEMENT ROUTES
     */

    // A1. Add New Product
    app.post(
      '/api/products/add',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const productData = {
            ...req.body,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          const result = await productsCollection.insertOne(productData);
          res
            .status(201)
            .send({ success: true, insertedId: result.insertedId });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // A2. Get Products for specific user (Pagination)
    app.get(
      '/api/my-products/:userId',
      verifyToken,
      async (req: Request, res: Response) => {
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
      },
    );

    // Helper: Cascading Product Deletion
    async function deleteProductCascading(productId: string) {
      if (ObjectId.isValid(productId)) {
        await productsCollection.deleteOne({ _id: new ObjectId(productId) });
      }
      await productsCollection.deleteOne({ _id: productId });
      await likesCollection.deleteMany({ productId });
      await commentsCollection.deleteMany({ productId });
      await cartCollection.deleteMany({ productId });
      await buyRequestsCollection.deleteMany({ productId });
    }

    // A3. Delete Product (Cascading Deletion of related likes, comments, cart, orders)
    app.delete(
      '/api/products/:id',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const id = req.params.id as string;
          await deleteProductCascading(id);
          res.send({
            success: true,
            message: 'Product and all associated data deleted successfully',
          });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // A4. Update Product (FIXED TYPE ERROR)
    app.patch(
      '/api/products/:id',
      verifyToken,
      async (req: Request, res: Response) => {
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
      },
    );

    // A5. Marketplace All Products (Strictly approved 'active' products for public view)
    app.get('/api/products/all', async (req: Request, res: Response) => {
      try {
        const { search, type, category, page } = req.query;
        const pageNum = parseInt(page as string) || 1;
        const limit = 8;
        const skip = (pageNum - 1) * limit;

        let query: any = { status: 'active' };

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

    // A6B. Public Featured Products (Admin-curated, max 6, shown on home page)
    app.get('/api/products/featured', async (req: Request, res: Response) => {
      try {
        const products = await productsCollection
          .find({ status: 'active', isFeatured: true })
          .sort({ featuredAt: -1 })
          .limit(6)
          .toArray();
        res.send({ success: true, products });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
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
          rating: c.rating || 5,
          comment: c.comment,
          date: c.createdAt,
          verified: true,
        }));

        // Real average rating from actual reviews; fall back to the seed
        // rating stored on the product itself if there are no reviews yet.
        const avgRating =
          reviews.length > 0
            ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) /
              reviews.length
            : product.rating || 0;

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
            rating: Number(avgRating.toFixed(1)),
            reviews: reviews.length, // review count for the header stars
          },
          reviews,
        });
      } catch (error: any) {
        res.status(500).send({ error: error.message });
      }
    });
    /**
     * A7. ADMIN MANAGEMENT ROUTES
     */

    // A7-1. Admin Get All Products (Includes pending, active, rejected with pagination & filtering)
    app.get(
      '/api/admin/products/all',
      verifyToken,
      verifyAdmin,
      async (req: Request, res: Response) => {
        try {
          const { search, type, category, status, page } = req.query;
          const pageNum = parseInt(page as string) || 1;
          const limit = 10;
          const skip = (pageNum - 1) * limit;

          let query: any = {};
          if (status && status !== 'All') query.status = status;
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
            totalProducts: total,
          });
        } catch (error: any) {
          res.status(500).send({ error: error.message });
        }
      },
    );

    // A7-2. Admin Update Product Status (Approve / Reject / Pending)
    app.patch(
      '/api/admin/products/:id/status',
      verifyToken,
      verifyAdmin,
      async (req: Request, res: Response) => {
        try {
          const id = req.params.id as string;
          const { status } = req.body;

          if (!ObjectId.isValid(id)) {
            return res
              .status(400)
              .send({ success: false, message: 'Invalid ID format' });
          }

          const result = await productsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status, updatedAt: new Date() } },
          );

          res.send({
            success: true,
            message: `Product status updated to ${status}`,
            result,
          });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // A7-2B. Admin Toggle "Featured" flag (Home Page Featured Section, max 6 at a time)
    app.patch(
      '/api/admin/products/:id/feature',
      verifyToken,
      verifyAdmin,
      async (req: Request, res: Response) => {
        try {
          const id = req.params.id as string;
          const { featured } = req.body;

          if (!ObjectId.isValid(id)) {
            return res
              .status(400)
              .send({ success: false, message: 'Invalid ID format' });
          }

          if (featured) {
            const target = await productsCollection.findOne({
              _id: new ObjectId(id),
            });
            if (!target?.isFeatured) {
              const featuredCount = await productsCollection.countDocuments({
                isFeatured: true,
              });
              if (featuredCount >= 6) {
                return res.status(400).send({
                  success: false,
                  error:
                    'Maximum 6 products can be featured on the home page. Please unfeature one first.',
                });
              }
            }
          }

          const result = await productsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                isFeatured: !!featured,
                featuredAt: featured ? new Date() : null,
                updatedAt: new Date(),
              },
            },
          );

          res.send({
            success: true,
            message: featured
              ? 'Product marked as featured on the home page'
              : 'Product removed from the featured section',
            result,
          });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // A7-3. Admin Get All Users
    app.get(
      '/api/admin/users',
      verifyToken,
      verifyAdmin,
      async (req: Request, res: Response) => {
        try {
          const users = await usersCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
          res.send({ success: true, users });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // A7-3B. Admin Get Single User (Profile + product count, for the user detail page)
    app.get(
      '/api/admin/users/:id',
      verifyToken,
      verifyAdmin,
      async (req: Request, res: Response) => {
        try {
          const id = req.params.id as string;
          const user = await usersCollection.findOne(
            ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id },
          );

          if (!user) {
            return res
              .status(404)
              .send({ success: false, error: 'User not found' });
          }

          const productCount = await productsCollection.countDocuments({
            userId: id,
          });

          res.send({ success: true, user, productCount });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // A7-4. Admin Delete User (Cascading deletion of user's products, comments, likes, cart, orders)
    app.delete(
      '/api/admin/users/:userId',
      verifyToken,
      verifyAdmin,
      async (req: Request, res: Response) => {
        try {
          const userId = req.params.userId as string;

          // 1. Delete all products created by user & run cascading deletion for each
          const userProducts = await productsCollection
            .find({ userId })
            .toArray();
          for (const p of userProducts) {
            await deleteProductCascading(p._id.toString());
          }

          // 2. Delete user from usersCollection
          if (ObjectId.isValid(userId)) {
            await usersCollection.deleteOne({ _id: new ObjectId(userId) });
          }
          await usersCollection.deleteOne({ _id: userId });
          await usersCollection.deleteOne({ id: userId });

          // 3. Delete comments left by this user
          await commentsCollection.deleteMany({ userId });

          // 4. Remove user from likesCollection
          const allLikes = await likesCollection.find({}).toArray();
          for (const doc of allLikes) {
            const updatedLikedBy = (doc.likedBy || []).filter(
              (u: any) =>
                !(
                  (typeof u === 'object' &&
                    (u.userId === userId || u.userName === userId)) ||
                  u === userId
                ),
            );
            await likesCollection.updateOne(
              { _id: doc._id },
              { $set: { likedBy: updatedLikedBy } },
            );
          }

          // 5. Remove user from cartCollection & buyRequestsCollection
          await cartCollection.updateMany({}, { $pull: { users: { userId } } });
          await cartCollection.deleteMany({ users: { $size: 0 } });

          await buyRequestsCollection.updateMany(
            {},
            { $pull: { users: { userId } } },
          );
          await buyRequestsCollection.deleteMany({ users: { $size: 0 } });

          // 6. Delete AI Crop Doctor diagnoses & AI Farm Analyzer history for this user
          await diagnosesCollection.deleteMany({ userId });
          await farmAnalysesCollection.deleteMany({ userId });

          res.send({
            success: true,
            message: 'User and all associated data deleted successfully',
          });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    /**
     * A-AI. AGENTIC AI FEATURES
     * (1) AI Content Generator  -> /api/ai/generate-description
     * (2) AI Chat Assistant     -> /api/ai/chat
     * (3) AI Crop Doctor        -> /api/ai/crop-doctor (+ diagnosis history)
     * (4) AI Farm Analyzer      -> /api/ai/farm-analyzer (+ analysis history)
     */

    // AI-1. Content Generator: writes a product/crop description from structured form data
    app.post(
      '/api/ai/generate-description',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const {
            title,
            category,
            productType,
            price,
            unit,
            isOrganic,
            grade,
            brand,
            condition,
            highlights,
            length, // 'short' | 'medium' | 'long'
          } = req.body;

          if (!title || !category) {
            return res.status(400).send({
              success: false,
              error: 'Title and category are required',
            });
          }

          const lengthGuide: Record<string, string> = {
            short: '2-3 concise sentences (about 40-60 words)',
            medium: 'one short paragraph (about 90-130 words)',
            long: 'two short paragraphs, the second one listing key highlights (about 160-220 words)',
          };
          const targetLength = lengthGuide[length] || lengthGuide.medium;

          const details =
            productType === 'Machine'
              ? `Brand: ${brand || 'N/A'}\nCondition: ${condition || 'N/A'}`
              : `Organic: ${isOrganic ? 'Yes' : 'No'}\nGrade: ${grade || 'N/A'}`;

          const prompt = `You are AgroVision AI's expert agri-marketplace copywriter.
Write a compelling, honest, buyer-focused product description for this listing on an online farm marketplace.

Product Type: ${productType || 'Crop'}
Title: ${title}
Category: ${category}
Price: ${price ?? 'N/A'} per ${unit || 'unit'}
${details}
Seller highlights: ${highlights || 'N/A'}

Rules:
- Length: ${targetLength}.
- Plain text only. No markdown, no asterisks, no emojis, no headings.
- Do not invent certifications, awards, or facts not given above.
- Sound natural and persuasive, suitable for buyers browsing a marketplace.`;

          const description = await generateTextWithAI(prompt);

          res.send({ success: true, description });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // AI-2. Chat Assistant: context-aware assistant with simple tool-use grounding
    // against the live products collection (agentic: it decides when to look up
    // real marketplace data before answering, instead of only generating text).
    app.post(
      '/api/ai/chat',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const { message, history, context } = req.body;
          if (!message) {
            return res
              .status(400)
              .send({ success: false, error: 'Message is required' });
          }

          // --- Tool use step: ground the reply in real listings when relevant ---
          let toolContext = '';
          const looksLikeProductQuery =
            /price|cost|available|stock|find|search|buy|sell|crop|machine|tractor|rice|wheat|fruit|vegetable/i.test(
              message,
            );

          if (looksLikeProductQuery) {
            const keywords = message
              .split(/\s+/)
              .filter((w: string) => w.length > 3)
              .map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
              .slice(0, 5);
            const escapedMessage = message.replace(
              /[.*+?^${}()|[\]\\]/g,
              '\\$&',
            );
            const regex = keywords.length ? keywords.join('|') : escapedMessage;

            const matches = await productsCollection
              .find({
                status: { $in: ['active', 'pending'] },
                $or: [
                  { title: { $regex: regex, $options: 'i' } },
                  { category: { $regex: regex, $options: 'i' } },
                ],
              })
              .limit(5)
              .toArray();

            if (matches.length) {
              toolContext = `\n\nLive marketplace data (use these real facts; never invent prices or availability):\n${matches
                .map(
                  (p: any) =>
                    `- ${p.title} | ${p.category} | Price: ${p.price}/${p.unit} | Location: ${p.location || 'N/A'}`,
                )
                .join('\n')}`;
            }
          }

          const historyText = (history || [])
            .slice(-6)
            .map(
              (h: any) =>
                `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`,
            )
            .join('\n');

          const prompt = `You are "AgroBot", the in-app AI assistant for AgroVision AI — an online marketplace where farmers list crops/machinery and buyers browse them.
Current page: ${context?.page || 'unknown'}${context?.productTitle ? ` (viewing "${context.productTitle}")` : ''}.

You can: answer questions, help with navigation (Marketplace, Add Product at /dashboard/farmer/add-crop, My Products, Login/Register), and reason over the chat history for follow-up questions.
Keep answers short and practical (max 4 sentences). If you don't have real data for something, say so instead of inventing it.
${toolContext}

Conversation so far:
${historyText}

User: ${message}
Assistant:`;

          const reply = await generateTextWithAI(prompt);

          // Lightweight suggested follow-ups (kept heuristic to avoid a second paid call)
          const suggestions = looksLikeProductQuery
            ? [
                'Show me the cheapest option',
                'How do I contact the seller?',
                'How do I list my own product?',
              ]
            : [
                'Browse the marketplace',
                'How do I add a product?',
                'How do I create an account?',
              ];

          res.send({ success: true, reply, suggestions });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
          console.error('AI Chat Error Details:', error);
        }
      },
    );

    // AI-3. Crop Doctor: multimodal image analysis to diagnose plant/crop health
    // from a photo. Agentic behavior: reasons over the uploaded image + farmer
    // notes, returns a structured diagnosis, and persists it so the farmer
    // builds a diagnosis history over time.
    app.post(
      '/api/ai/crop-doctor',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const {
            imageBase64,
            mimeType,
            imageUrl,
            userId,
            userName,
            cropHint,
            notes,
          } = req.body;

          if (!imageBase64) {
            return res
              .status(400)
              .send({ success: false, error: 'imageBase64 is required' });
          }

          const cleanBase64 = imageBase64.includes(',')
            ? imageBase64.split(',')[1]
            : imageBase64;

          const prompt = `You are "AgroDoc", an expert agronomist and plant pathologist AI inside AgroVision AI, a farm marketplace app.
Look carefully at the attached crop/plant photo and diagnose its health.
${cropHint ? `The farmer says the crop is: ${cropHint}.` : 'Identify the crop/plant yourself from the image.'}
${notes ? `Farmer's notes: ${notes}` : ''}

Respond with ONLY valid JSON (no markdown, no commentary) in exactly this shape:
{
  "cropIdentified": string,
  "isHealthy": boolean,
  "diagnosis": string,
  "severity": "Healthy" | "Low" | "Moderate" | "High",
  "confidencePercent": number,
  "symptoms": string[],
  "likelyCauses": string[],
  "organicTreatment": string[],
  "chemicalTreatment": string[],
  "preventionTips": string[],
  "estimatedRecoveryTime": string
}

Rules:
- Base every field only on what is visible in the image plus the farmer's notes; never invent facts.
- If the photo does not clearly show a plant/crop, set cropIdentified to "Unknown" and explain why in diagnosis.
- Keep each array to 2-5 short, practical items.`;

          const raw = await analyzeImageWithAI(
            prompt,
            cleanBase64,
            mimeType || 'image/jpeg',
          );
          const analysis = safeParseAIJson(raw);

          const diagnosisDoc = {
            userId: userId || 'anonymous',
            userName: userName || 'Anonymous',
            imageUrl: imageUrl || '',
            cropHint: cropHint || '',
            notes: notes || '',
            analysis,
            createdAt: new Date(),
          };

          const result = await diagnosesCollection.insertOne(diagnosisDoc);

          res.send({
            success: true,
            diagnosis: { _id: result.insertedId, ...diagnosisDoc },
          });
        } catch (error: any) {
          console.error('AI Crop Doctor Error:', error);
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // AI-3B. Diagnosis History for a farmer
    app.get(
      '/api/ai/diagnoses/:userId',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const userId = req.params.userId as string;
          const diagnoses = await diagnosesCollection
            .find({ userId })
            .sort({ createdAt: -1 })
            .toArray();
          res.send({ success: true, diagnoses });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // AI-3C. Delete a diagnosis record
    app.delete(
      '/api/ai/diagnoses/:id',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const id = req.params.id as string;
          if (!ObjectId.isValid(id))
            return res
              .status(400)
              .send({ success: false, error: 'Invalid ID' });
          await diagnosesCollection.deleteOne({ _id: new ObjectId(id) });
          res.send({ success: true, message: 'Diagnosis deleted' });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // AI-4. Farm Analyzer: agentic data analysis + recommendation engine.
    // Tool-use step: pulls the farmer's own live listings before reasoning, so
    // recommendations are grounded in what they actually grow, not generic advice.
    app.post(
      '/api/ai/farm-analyzer',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const {
            userId,
            cropType,
            soilType,
            landSize,
            landUnit,
            location,
            season,
            budget,
            irrigationType,
            farmingType,
            experience,
          } = req.body;

          if (!cropType || !soilType || !landSize) {
            return res.status(400).send({
              success: false,
              error: 'cropType, soilType and landSize are required',
            });
          }

          // --- Tool use: ground the analysis in the farmer's real listing history ---
          let farmerContext = 'No prior listings found for this farmer.';
          if (userId) {
            const pastProducts = await productsCollection
              .find({ userId })
              .sort({ createdAt: -1 })
              .limit(5)
              .toArray();
            if (pastProducts.length) {
              farmerContext = `Farmer's recent listings on AgroVision: ${pastProducts
                .map(
                  (p: any) =>
                    `${p.title} (${p.category}, ${p.price}/${p.unit})`,
                )
                .join('; ')}.`;
            }
          }

          const prompt = `You are "AgroAnalyst", an agricultural data analyst AI inside AgroVision AI.
Analyze this farm plan and return a structured, realistic assessment. Use real agronomic reasoning, not generic filler.

Farm Plan:
- Crop: ${cropType}
- Soil type: ${soilType}
- Land size: ${landSize} ${landUnit || 'acres'}
- Location: ${location || 'Not specified'}
- Season: ${season || 'Not specified'}
- Budget: ${budget || 'Not specified'}
- Irrigation: ${irrigationType || 'Not specified'}
- Farming type: ${farmingType || 'Conventional'}
- Farmer experience: ${experience || 'Not specified'}

${farmerContext}

Respond with ONLY valid JSON (no markdown, no commentary) in exactly this shape:
{
  "suitabilityScore": number,
  "summary": string,
  "estimatedYield": { "min": number, "max": number, "unit": string },
  "estimatedROI": { "min": number, "max": number, "currency": string },
  "riskFactors": [ { "risk": string, "level": "Low" | "Medium" | "High", "mitigation": string } ],
  "recommendedCrops": [ { "name": string, "suitabilityPercent": number, "reason": string } ],
  "fertilizerPlan": [ { "name": string, "purpose": string, "timing": string } ],
  "irrigationAdvice": string,
  "timeline": [ { "phase": string, "durationWeeks": number, "tasks": string[] } ],
  "marketInsight": string
}

Rules:
- suitabilityScore is 0-100, reflecting how well the crop matches soil, season and location.
- Give 2-4 riskFactors, 2-4 recommendedCrops, 2-4 fertilizerPlan entries, 3-5 timeline phases.
- Numbers should be realistic estimates, not placeholders like 0 or 100 unless truly appropriate.`;

          const raw = await generateJSONWithAI(prompt);
          const analysis = safeParseAIJson(raw);

          const analysisDoc = {
            userId: userId || 'anonymous',
            input: {
              cropType,
              soilType,
              landSize,
              landUnit,
              location,
              season,
              budget,
              irrigationType,
              farmingType,
              experience,
            },
            analysis,
            createdAt: new Date(),
          };
          const result = await farmAnalysesCollection.insertOne(analysisDoc);

          res.send({
            success: true,
            analysis: { _id: result.insertedId, ...analysisDoc },
          });
        } catch (error: any) {
          console.error('AI Farm Analyzer Error:', error);
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // AI-4B. Recent Farm Analyses for a farmer
    app.get(
      '/api/ai/farm-analyses/:userId',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const userId = req.params.userId as string;
          const analyses = await farmAnalysesCollection
            .find({ userId })
            .sort({ createdAt: -1 })
            .limit(10)
            .toArray();
          res.send({ success: true, analyses });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    /**
     * B. LIKES & COMMENTS
     */

    app.post(
      '/api/likes/toggle',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const { productId, userId, userName } = req.body;
          const existing = await likesCollection.findOne({ productId });

          const userObj = {
            userId: userId || 'anonymous',
            userName: userName || 'Anonymous',
          };

          if (!existing) {
            await likesCollection.insertOne({ productId, likedBy: [userObj] });
            return res.send({ success: true, liked: true, likesCount: 1 });
          }

          const likedByList: any[] = existing.likedBy || [];
          const alreadyLiked = likedByList.some(
            (u: any) =>
              (typeof u === 'object' &&
                (u.userId === userId || u.userName === userName)) ||
              u === userName,
          );

          if (alreadyLiked) {
            const updatedList = likedByList.filter(
              (u: any) =>
                !(
                  (typeof u === 'object' &&
                    (u.userId === userId || u.userName === userName)) ||
                  u === userName
                ),
            );
            await likesCollection.updateOne(
              { productId },
              { $set: { likedBy: updatedList } },
            );
            res.send({
              success: true,
              liked: false,
              likesCount: updatedList.length,
            });
          } else {
            await likesCollection.updateOne(
              { productId },
              { $push: { likedBy: userObj } },
            );
            res.send({
              success: true,
              liked: true,
              likesCount: likedByList.length + 1,
            });
          }
        } catch (error: any) {
          res.status(500).send({ error: error.message });
        }
      },
    );

    app.get('/api/likes/:productId', async (req: Request, res: Response) => {
      const doc = await likesCollection.findOne({
        productId: req.params.productId,
      });
      const likedBy: any[] = doc?.likedBy || [];
      const { userId, userName } = req.query;

      const isLiked = likedBy.some(
        (u: any) =>
          (typeof u === 'object' &&
            (u.userId === userId || u.userName === userName)) ||
          u === userName,
      );

      res.send({
        likesCount: likedBy.length,
        isLiked: Boolean(isLiked),
      });
    });

    app.post(
      '/api/comments/add',
      verifyToken,
      async (req: Request, res: Response) => {
        const { productId, userId, userName, userImage, comment, rating } =
          req.body;
        const commentData = {
          productId,
          userId,
          userName,
          userImage,
          comment: comment.trim(),
          rating: rating ? Math.min(5, Math.max(1, Number(rating))) : 5,
          createdAt: new Date(),
        };
        const result = await commentsCollection.insertOne(commentData);
        res.status(201).send({
          success: true,
          comment: { _id: result.insertedId, ...commentData },
        });
      },
    );

    app.get('/api/comments/:productId', async (req: Request, res: Response) => {
      const comments = await commentsCollection
        .find({ productId: req.params.productId })
        .sort({ createdAt: -1 })
        .toArray();
      res.send({ success: true, comments });
    });

    app.delete(
      '/api/comments/:id',
      verifyToken,
      async (req: Request, res: Response) => {
        const id = req.params.id as string;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ error: 'Invalid ID' });
        await commentsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true, message: 'Comment deleted' });
      },
    );

    /**
     * C. BUY REQUESTS & ORDERS ROUTES
     */

    // C1. Submit Buy Request (Buy Now)
    app.post(
      '/api/buy-requests',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const {
            productId,
            productTitle,
            mainImage,
            price,
            unit,
            sellerId,
            sellerName,
            user,
          } = req.body;

          if (!productId || !user?.userId) {
            return res.status(400).send({
              success: false,
              error: 'Product ID and User info required',
            });
          }

          const existingDoc = await buyRequestsCollection.findOne({
            productId,
          });

          if (existingDoc) {
            const userAlreadyInArray = existingDoc.users?.some(
              (u: any) => u.userId === user.userId,
            );

            if (userAlreadyInArray) {
              return res.send({
                success: true,
                message: 'Already submitted buy request for this product',
                alreadyExists: true,
              });
            }

            await buyRequestsCollection.updateOne(
              { productId },
              {
                $push: {
                  users: {
                    userId: user.userId,
                    userName: user.userName || 'Anonymous',
                    userEmail: user.userEmail || '',
                    userImage: user.userImage || '',
                    status: 'pending',
                    createdAt: new Date(),
                  },
                },
              },
            );
          } else {
            await buyRequestsCollection.insertOne({
              productId,
              productTitle: productTitle || 'Agro Product',
              mainImage: mainImage || '',
              price: price || 0,
              unit: unit || 'unit',
              sellerId: sellerId || 'anonymous',
              sellerName: sellerName || 'AgroVision Seller',
              users: [
                {
                  userId: user.userId,
                  userName: user.userName || 'Anonymous',
                  userEmail: user.userEmail || '',
                  userImage: user.userImage || '',
                  status: 'pending',
                  createdAt: new Date(),
                },
              ],
              createdAt: new Date(),
            });
          }

          res.status(201).send({
            success: true,
            message: 'Buy request submitted successfully',
          });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // C2. Get Buy Requests by Buyer User ID (For "My Requests" page)
    app.get(
      '/api/buy-requests/user/:userId',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const userId = req.params.userId as string;
          const docs = await buyRequestsCollection
            .find({ 'users.userId': userId })
            .toArray();

          const requests = docs.map((doc: any) => {
            const userReq = doc.users?.find((u: any) => u.userId === userId);
            return {
              _id: doc._id.toString(),
              productId: doc.productId,
              productTitle: doc.productTitle,
              mainImage: doc.mainImage,
              price: doc.price,
              unit: doc.unit,
              sellerName: doc.sellerName,
              status: userReq?.status || 'pending',
              createdAt: userReq?.createdAt || doc.createdAt,
            };
          });

          res.send({ success: true, requests });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // C3. Get Orders for Seller ID (For "My Orders" page)
    app.get(
      '/api/buy-requests/seller/:sellerId',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const sellerId = req.params.sellerId as string;
          const docs = await buyRequestsCollection.find({ sellerId }).toArray();

          const orders: any[] = [];
          docs.forEach((doc: any) => {
            doc.users?.forEach((u: any) => {
              orders.push({
                _id: doc._id.toString(),
                productId: doc.productId,
                productTitle: doc.productTitle,
                mainImage: doc.mainImage,
                price: doc.price,
                unit: doc.unit,
                userId: u.userId,
                userName: u.userName,
                userEmail: u.userEmail,
                userImage: u.userImage,
                status: u.status,
                createdAt: u.createdAt,
              });
            });
          });

          orders.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );

          res.send({ success: true, orders });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // C4. Update Order Request Status (Accept / Reject)
    app.patch(
      '/api/buy-requests/status',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const { productId, userId, status } = req.body;
          if (!productId || !userId || !status) {
            return res.status(400).send({
              success: false,
              error: 'productId, userId, status required',
            });
          }

          const result = await buyRequestsCollection.updateOne(
            { productId, 'users.userId': userId },
            { $set: { 'users.$.status': status } },
          );

          res.send({
            success: true,
            message: `Order status updated to ${status}`,
            result,
          });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // C5. Delete Buy Request by Buyer (Removes user from array)
    app.delete(
      '/api/buy-requests/:productId/:userId',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const productId = req.params.productId as string;
          const userId = req.params.userId as string;

          await buyRequestsCollection.updateOne(
            { productId },
            { $pull: { users: { userId } } },
          );

          // If no users left in users array, remove the document
          await buyRequestsCollection.deleteOne({
            productId,
            users: { $size: 0 },
          });

          res.send({
            success: true,
            message: 'Buy request deleted successfully',
          });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    /**
     * D. CART ROUTES
     */

    // D1. Add to Cart
    app.post('/api/cart', verifyToken, async (req: Request, res: Response) => {
      try {
        const {
          productId,
          productTitle,
          mainImage,
          price,
          unit,
          category,
          sellerId,
          user,
        } = req.body;

        if (!productId || !user?.userId) {
          return res.status(400).send({
            success: false,
            error: 'Product ID and User info required',
          });
        }

        const existingDoc = await cartCollection.findOne({ productId });

        if (existingDoc) {
          const userAlreadyInArray = existingDoc.users?.some(
            (u: any) => u.userId === user.userId,
          );

          if (userAlreadyInArray) {
            return res.send({
              success: true,
              message: 'Product is already in your cart',
              alreadyExists: true,
            });
          }

          await cartCollection.updateOne(
            { productId },
            {
              $push: {
                users: {
                  userId: user.userId,
                  userName: user.userName || 'Anonymous',
                  userEmail: user.userEmail || '',
                  userImage: user.userImage || '',
                  addedAt: new Date(),
                },
              },
            },
          );
        } else {
          await cartCollection.insertOne({
            productId,
            productTitle: productTitle || 'Agro Product',
            mainImage: mainImage || '',
            price: price || 0,
            unit: unit || 'unit',
            category: category || 'General',
            sellerId: sellerId || 'anonymous',
            users: [
              {
                userId: user.userId,
                userName: user.userName || 'Anonymous',
                userEmail: user.userEmail || '',
                userImage: user.userImage || '',
                addedAt: new Date(),
              },
            ],
            createdAt: new Date(),
          });
        }

        res.status(201).send({
          success: true,
          message: 'Product added to cart successfully',
        });
      } catch (error: any) {
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // D2. Get Cart Items by User ID
    app.get(
      '/api/cart/:userId',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const userId = req.params.userId as string;
          const docs = await cartCollection
            .find({ 'users.userId': userId })
            .toArray();

          const cartItems = docs.map((doc: any) => {
            const userCart = doc.users?.find((u: any) => u.userId === userId);
            return {
              _id: doc._id.toString(),
              productId: doc.productId,
              productTitle: doc.productTitle,
              mainImage: doc.mainImage,
              price: doc.price,
              unit: doc.unit,
              category: doc.category,
              addedAt: userCart?.addedAt || doc.createdAt,
            };
          });

          res.send({ success: true, cartItems });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );

    // D3. Remove Item from Cart (Removes user from array)
    app.delete(
      '/api/cart/:productId/:userId',
      verifyToken,
      async (req: Request, res: Response) => {
        try {
          const productId = req.params.productId as string;
          const userId = req.params.userId as string;

          await cartCollection.updateOne(
            { productId },
            { $pull: { users: { userId } } },
          );

          await cartCollection.deleteOne({
            productId,
            users: { $size: 0 },
          });

          res.send({
            success: true,
            message: 'Item removed from cart',
          });
        } catch (error: any) {
          res.status(500).send({ success: false, error: error.message });
        }
      },
    );
  } catch (error) {
    console.error('❌ DATABASE ERROR:', error);
  }
}

run().catch(console.dir);

app.get('/', (_req: Request, res: Response) =>
  res.send('🌾 AgroVision API is Live'),
);

const server = app.listen(port, () =>
  console.log(`🚀 Server: http://localhost:${port}`),
);

const shutdown = () => {
  server.close(() => {
    console.log('🛑 Server stopped');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
