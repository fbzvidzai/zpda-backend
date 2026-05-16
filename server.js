require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const nodemailer = require("nodemailer");
const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const crypto = require("crypto");
const dns = require("dns");

dns.setDefaultResultOrder("ipv4first");

process.on("uncaughtException", err => {
  console.error("🔥 Uncaught Exception:", err);
});

process.on("unhandledRejection", err => {
  console.error("🔥 Unhandled Rejection:", err);
});

fs.ensureDirSync(path.join(__dirname, "teaching-resources"));
fs.ensureDirSync(path.join(__dirname, "research-papers"));

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = express();

app.use((req, res, next) => {
  console.log("➡️", req.method, req.url);
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json());
app.use(cors());
app.use(express.static("public"));
app.use("/research-papers", express.static(path.join(__dirname, "research-papers")));
app.use("/teaching-resources", express.static(path.join(__dirname, "teaching-resources")));

// =======================
// TAURAAI ROUTE
// =======================
app.post("/ask-ai", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ answer: "No question received" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are TauraAI, an expert assistant for Zimbabwean Poetry Digital Archive. Focus on Zimbabwean poetry, oral traditions, culture, and literature."
        },
        {
          role: "user",
          content: question
        }
      ]
    });

    res.json({
      answer: response.choices[0].message.content
    });

  } catch (err) {
    console.error("TauraAI Error:", err);
    res.status(200).json({
  answer: "TauraAI Coming Soon 🚀"
});
  }
});
// =======================
// =======================
// =======================
// MONGODB CONNECTION (FIXED)
// =======================
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is missing in .env");
  process.exit(1);
}

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 5000, // fail fast if no connection
})
.then(() => {
  console.log("✅ MongoDB connected successfully");
})
.catch((err) => {
  console.error("❌ Initial MongoDB connection error:", err.message);
});

// Optional: better event logging
mongoose.connection.on("connected", () => {
  console.log("📡 MongoDB event: connected");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB runtime error:", err.message);
});

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected");
});
// =======================
// SCHEMAS
// =======================
const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  blocked: { type: Boolean, default: false },
  newsletter: { type: Boolean, default: true }, // ✅ NEW
  resetToken: { type: String, default: null },
resetTokenExpiry: { type: Date, default: null }
});

const poemSchema = new mongoose.Schema({
  title: String,
  author: String,
  text: String,
  language: String,
  genre: String,
  period: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  likes: { type: Number, default: 0 },
  likedBy: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

const researchSchema = new mongoose.Schema({
  title: { type: String, required: true },
  authors: { type: String, required: true },
  year: { type: Number, required: true },
  abstract: { type: String, required: true },
  keywords: { type: [String], default: [] },
  file: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Poem = mongoose.model("Poem", poemSchema);
const Research = mongoose.model("Research", researchSchema);

// =======================
// CREATE OR UPDATE DEFAULT ADMIN (CONNECTED TO .ENV)
// =======================
async function ensureAdmin() {
  try {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      console.warn("⚠️ ADMIN_EMAIL or ADMIN_PASSWORD not set in .env");
      return;
    }

    const existingAdmin = await User.findOne({ email, role: "admin" });

    if (!existingAdmin) {
      // Create new admin
      const hashed = await bcrypt.hash(password, 10);
      await User.create({
        username: "Admin",
        email,
        password: hashed,
        role: "admin"
      });
      console.log("✅ Default admin created");
    } else {
      // Update password if it changed in .env
      const passwordMatches = await bcrypt.compare(password, existingAdmin.password);
      if (!passwordMatches) {
        const hashed = await bcrypt.hash(password, 10);
        existingAdmin.password = hashed;
        await existingAdmin.save();
        console.log("✅ Admin password updated from .env");
      } else {
        console.log("✅ Admin already exists and password matches .env");
      }
    }
  } catch (err) {
    console.error("❌ Failed to create/update default admin", err);
  }
}
mongoose.connection.once("open", ensureAdmin);


// =======================
// AUTH MIDDLEWARE
// =======================
function auth(req, res, next){
  const header = req.headers.authorization;
  if(!header) return res.status(401).json({ error: "No token provided" });

  const token = header.startsWith("Bearer ") ? header.split(" ")[1] : header;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch(err){
    res.status(401).json({ error: "Invalid token" });
  }
}

// =======================
// ADMIN AUTH MIDDLEWARE
// =======================
function verifyAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "No token provided" });

  const token = header.startsWith("Bearer ") ? header.split(" ")[1] : header;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "admin") return res.status(403).json({ error: "Access denied" });
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
}

// =======================
// EMAIL CONFIG
// =======================
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  connectionTimeout: 60000,
  greetingTimeout: 60000,
  socketTimeout: 60000
});

transporter.verify(function (error, success) {
  if (error) {
    console.log("SMTP ERROR:", error);
  } else {
    console.log("SMTP READY");
  }
});



const sendMailSafe = async (mailOptions) => {
  try {
    return await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error("❌ Email failed:", err.message);
    return null;
  }
};

// =======================
// TEST EMAIL FUNCTION
// =======================
async function sendTestEmail(to, subject, text) {
  try {
    let info = await transporter.sendMail({
      from: process.env.ADMIN_EMAIL,
      to,
      subject,
      text
    });
    console.log("✅ Email sent:", info.response);
  } catch (err) {
    console.error("❌ Email failed:", err);
  }
}

// =======================
// NEWSLETTER SUBSCRIBE
// =======================
app.put("/newsletter/subscribe", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.newsletter = true;
    await user.save();
    res.json({ message: "Subscribed to newsletter ✅" });
  } catch (err) {
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

app.put("/newsletter/unsubscribe", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.newsletter = false;
    await user.save();
    res.json({ message: "Unsubscribed from newsletter ❌" });
  } catch (err) {
    res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

// =======================
// AUTH ROUTES
// =======================
app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;
  if(!username || !email || !password) return res.json({ error: "All fields are required" });

  const exists = await User.findOne({ email });
  if(exists) return res.json({ error: "User already exists" });

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ username, email, password: hashed });

  const token = jwt.sign(
    { _id: user._id, username: user.username, role: user.role },
    process.env.JWT_SECRET
  );

  res.json({ user: { _id: user._id, username: user.username, email: user.email, role: user.role }, token });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.json({ error: "User not found" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ error: "Wrong password" });

  const token = jwt.sign(
    { _id: user._id, username: user.username, role: user.role },
    process.env.JWT_SECRET
  );

  res.json({
    user: {
      _id: user._id,
      username: user.username,
      email: user.email,
      role: user.role
    },
    token
  });
});   // 👈 THIS CLOSES LOGIN ROUTE

app.post('/send-email', verifyAdmin, async (req, res) => {
  const { subject, body } = req.body;

  if (!subject || !body) {
    return res.status(400).json({ error: "Subject and body required" });
  }

  try {
    const users = await User.find({ blocked: false }).select("email username");

    // fire-and-forget
    setImmediate(() => {
      users.forEach(user => {
        transporter.sendMail({
          from: `"ZPDA Admin" <${process.env.SMTP_USER}>`,
          to: user.email,
          subject,
          text: `Hello ${user.username},\n\n${body}`
        }).catch(err => console.log("Email failed:", user.email));
      });
    });

    res.json({ message: "Emails queued successfully 🚀" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send emails" });
  }
});
app.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.json({ error: "User not found" });
    }

    const tempPassword = crypto.randomBytes(4).toString("hex");

    const hashed = await bcrypt.hash(tempPassword, 10);

    user.password = hashed;

    await user.save();

    const info = await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject: "Temporary Password",
      text: `Your temporary password is: ${tempPassword}`
    });

    console.log("✅ Email sent:", info.response);

    res.json({
      message: "Temporary password sent successfully"
    });

  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({
      error: "Server error"
    });
  }
});

// =======================
// ADMIN LOGIN
// =======================
app.post("/admin-login", async (req, res) => {
  const { email, password } = req.body;
  const admin = await User.findOne({ email, role: "admin" });
  if(!admin) return res.status(401).json({ error: "Access denied" });

  const match = await bcrypt.compare(password, admin.password);
  if(!match) return res.status(401).json({ error: "Wrong password" });

  const token = jwt.sign(
    { _id: admin._id, username: admin.username, role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token });
});

// =======================
// POEMS ROUTES
// =======================
app.post("/poems", auth, async (req, res) => {
  const { title, text, language, genre, period, author } = req.body;
  if(!title || !text) return res.json({ error: "Missing fields" });

  const poem = await Poem.create({
    title,
    text,
    language,
    genre,
    period,
    author: author || req.user.username, // ✅ optional author name
    userId: req.user._id
  });

  res.json(poem);
});

app.put("/poems/:id", auth, async (req, res) => {
  try {
    const poem = await Poem.findById(req.params.id);
    if(!poem) return res.status(404).json({ error: "Poem not found" });

    if(req.user.role !== "admin" && poem.userId.toString() !== req.user._id)
      return res.status(403).json({ error: "Not allowed" });

    const { title, text, language, genre, period } = req.body;
    if(title) poem.title = title;
    if(text) poem.text = text;
    if(language) poem.language = language;
    if(genre) poem.genre = genre;
    if(period) poem.period = period;

    await poem.save();
    res.json({ message: "Poem updated ✅", poem });
  } catch(err) {
    res.status(500).json({ error: "Failed to edit poem" });
  }
});

app.delete("/poems/:id", auth, async (req, res) => {
  try {
    const poem = await Poem.findById(req.params.id);
    if(!poem) return res.status(404).json({ error: "Poem not found" });

    if(req.user.role !== "admin" && poem.userId.toString() !== req.user._id)
      return res.status(403).json({ error: "Not allowed" });

    await poem.deleteOne();
    res.json({ message: "Poem deleted ✅" });
  } catch(err) {
    res.status(500).json({ error: "Failed to delete poem" });
  }

  
});

app.get("/poems", async (req, res) => {
  const poems = await Poem.find().sort({ createdAt: -1 });
  res.json(poems);
});

// =======================
// LIKE POEM (LIVE UPDATE)
// =======================
app.put("/poems/:id/like", auth, async (req, res) => {
  try {
    const poem = await Poem.findById(req.params.id);
    if (!poem) return res.status(404).json({ error: "Poem not found" });

    const userId = req.user._id.toString();

    // check if user already liked
    if (poem.likedBy.includes(userId)) {
      // unlike
      poem.likedBy = poem.likedBy.filter(id => id !== userId);
      poem.likes = Math.max(poem.likes - 1, 0);
    } else {
      // like
      poem.likedBy.push(userId);
      poem.likes += 1;
    }

    await poem.save();

    res.json({
      likes: poem.likes,
      likedBy: poem.likedBy
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Like failed" });
  }
});

// =======================
// 🔥 NEW ROUTE: GET MY POEMS
// =======================
app.get("/my-poems", auth, async (req, res) => {
  try {
    const poems = await Poem.find({
      $or: [
        { userId: req.user._id },
        { userId: String(req.user._id) },
        { author: req.user.username }
      ]
    }).sort({ createdAt: -1 });

    res.json(poems);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch your poems" });
  }
});

// =======================
// RESEARCH PAPERS ROUTES (FIXED)
// =======================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "research-papers/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const researchUpload = multer({ storage });

const teachingStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "teaching-resources/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const teachingUpload = multer({ storage: teachingStorage });

app.get("/research-papers", auth, async (req, res) => {
  try {
    const papers = await Research.find().sort({ createdAt: -1 });
    const formatted = papers.map(p => {
      const fileUrl = p.file.startsWith("http")
        ? p.file
        : `${req.protocol}://${req.get("host")}${p.file}`;
      return { ...p._doc, fileUrl };
    });
    res.json(formatted);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch research papers" });
  }
});

app.post("/research-papers", auth, researchUpload.single("file"), async (req, res) => {
  const { title, authors, year, abstract, keywords } = req.body;

  const paper = await Research.create({
    title,
    authors,
    year: parseInt(year),
    abstract,
    keywords: keywords ? keywords.split(",").map(k => k.trim()) : [],
    file: `/research-papers/${req.file.filename}`
  });

  res.json(paper);
});

app.put("/research-papers/:id", auth, async (req, res) => {
  const { title, authors, year, abstract, keywords } = req.body;

  const paper = await Research.findById(req.params.id);
  if(!paper) return res.status(404).json({ error: "Paper not found" });

  if(title) paper.title = title;
  if(authors) paper.authors = authors;
  if(year) paper.year = year;
  if(abstract) paper.abstract = abstract;
  if(keywords) paper.keywords = keywords;

  await paper.save();
  res.json({ message: "Research paper updated ✅", paper });
});

app.delete("/research-papers/:id", auth, async (req, res) => {
  const paper = await Research.findById(req.params.id);
  if(!paper) return res.status(404).json({ error: "Paper not found" });

  await fs.remove(path.join(__dirname, paper.file.replace("/", "")));
  await paper.deleteOne();
  res.json({ message: "Research paper deleted ✅" });
});

app.get("/teaching-resources", async (req, res) => {
  try {
    const items = await Teaching.find().sort({ createdAt: -1 });

    const formatted = items.map(t => ({
      ...t._doc,
      fileUrl: `${req.protocol}://${req.get("host")}${t.file}`
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch teaching resources" });
  }
});


// =======================
// USERS MANAGEMENT
// =======================
app.get("/users", auth, async (req,res)=>{
  if(req.user.role !== "admin") return res.status(403).json({ error:"Access denied" });
  const users = await User.find().sort({ username: 1 });
  res.json(users);
});

app.put("/users/:id/block", auth, async (req,res)=>{
  if(req.user.role !== "admin") return res.status(403).json({ error:"Access denied" });
  const user = await User.findById(req.params.id);
  if(!user) return res.status(404).json({ error:"User not found" });
  user.blocked = true;
  await user.save();
  res.json({ message:"User blocked ✅" });
});

app.put("/users/:id/unblock", auth, async (req,res)=>{
  if(req.user.role !== "admin") return res.status(403).json({ error:"Access denied" });
  const user = await User.findById(req.params.id);
  if(!user) return res.status(404).json({ error:"User not found" });
  user.blocked = false;
  await user.save();
  res.json({ message:"User unblocked ✅" });
});

app.delete("/users/:id", auth, async (req,res)=>{
  if(req.user.role !== "admin") return res.status(403).json({ error:"Access denied" });
  const user = await User.findById(req.params.id);
  if(!user) return res.status(404).json({ error:"User not found" });
  await user.deleteOne();
  res.json({ message:"User deleted ✅" });
});

// =======================
// GET CURRENT LOGGED-IN USER
// =======================
app.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user info" });
  }
});

// ================= SEND EMAIL =================
app.post('/send-email', verifyAdmin, async (req, res) => {
  const { subject, body } = req.body;

  if (!subject || !body) {
    return res.status(400).json({ error: "Subject and body required" });
  }

  try {
    const users = await User.find({ blocked: false }).select("email username");

    for (let user of users) {
      try {
        await transporter.sendMail({
          from: `"ZPDA Admin" <${process.env.SMTP_USER}>`,
          to: user.email,
          subject: subject,
          text: `Hello ${user.username},\n\n${body}`
        });
      } catch (err) {
        console.log("Email failed for:", user.email);
      }
    }

    res.json({ message: "Emails sent successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send emails" });
  }
});

// =======================
// ADS SCHEMA
// =======================
const adSchema = new mongoose.Schema({
  text: { type: String, required: true },
  image: { type: String, default: null },
  duration: { type: Number, default: 1 },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  approvalCode: { type: String, required: true },
  approved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const Ad = mongoose.model("Ad", adSchema);

const teachingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String, default: "Anonymous" },
  subject: { type: String },
  description: { type: String },
  file: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Teaching = mongoose.model("Teaching", teachingSchema);

// =======================
// SUBMIT AD ROUTE
// =======================
app.post("/ads", async (req, res) => {
  const { text, image, duration, name, phone, approvalCode } = req.body;

  if (!text || !name || !phone || !approvalCode)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    const ad = await Ad.create({
      text,
      image,
      duration,
      name,
      phone,
      approvalCode,
      approved: false
    });

    res.json({ message: "Ad submitted for approval ✅", ad });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit ad" });
  }
});

// =======================
// GET ADS FOR ADMIN DASHBOARD
// =======================
app.get("/admin/ads", verifyAdmin, async (req, res) => {
  try {
    const ads = await Ad.find().sort({ createdAt: -1 });
    res.json(ads);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch ads" });
  }
});

// =======================
// APPROVE AD
// =======================
app.put("/admin/ads/:id/approve", verifyAdmin, async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    ad.approved = true;
    await ad.save();

    res.json({ message: "Ad approved ✅", ad });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve ad" });
  }
});

// =======================
// DELETE AD
// =======================
app.delete("/admin/ads/:id", verifyAdmin, async (req, res) => {
  try {
    const ad = await Ad.findById(req.params.id);
    if (!ad) return res.status(404).json({ error: "Ad not found" });

    await ad.deleteOne();
    res.json({ message: "Ad deleted ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete ad" });
  }
});

// =======================
// GET APPROVED ADS FOR HOMEPAGE
// =======================
app.get("/ads", async (req, res) => {
  try {
    const ads = await Ad.find({ approved: true }).sort({ createdAt: -1 });
    res.json(ads);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch ads" });
  }
  
});

app.post("/teaching-resources", auth, teachingUpload.single("file"), async (req, res) => {
  try {
    const { title, author, subject, description } = req.body;

    const resource = await Teaching.create({
      title,
      author,
      subject,
      description,
      file: `/teaching-resources/${req.file.filename}`
    });

    res.json(resource);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.put("/teaching-resources/:id", auth, async (req, res) => {
  try {
    const resource = await Teaching.findById(req.params.id);
    if (!resource) return res.status(404).json({ error: "Not found" });

    const { title, author, subject } = req.body;

    if (title) resource.title = title;
    if (author) resource.author = author;
    if (subject) resource.subject = subject;

    await resource.save();

    res.json({ message: "Updated ✅", resource });
  } catch (err) {
    res.status(500).json({ error: "Update failed" });
  }
});

app.delete("/teaching-resources/:id", auth, async (req, res) => {
  try {
    const resource = await Teaching.findById(req.params.id);
    if (!resource) return res.status(404).json({ error: "Not found" });

    await resource.deleteOne();

    res.json({ message: "Deleted ✅" });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT} 🚀`));