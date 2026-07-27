import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// --- 1. INITIAL CONFIGURATIONS ---
dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// --- 1B. AI CONFIGURATION & HELPER ---
// Powers the two Agentic AI features: (1) AI Content Generator and (2) AI Chat Assistant
async function generateTextWithAI(prompt: string): Promise<string> {
  const grokApiKey = process.env.GROK_API_KEY;
  if (grokApiKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${grokApiKey}`,
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
     * A-AI. AGENTIC AI FEATURES
     * (1) AI Content Generator  -> /api/ai/generate-description
     * (2) AI Chat Assistant     -> /api/ai/chat
     */

    // AI-1. Content Generator: writes a product/crop description from structured form data
    app.post(
      '/api/ai/generate-description',
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
    app.post('/api/ai/chat', async (req: Request, res: Response) => {
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
          const escapedMessage = message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
