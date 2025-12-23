import mongoose from "mongoose";

const articleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  views: { type: Number, default: 0 },
  status: { type: String, enum: ["Draft", "Published"], default: "Draft" },
  category: { type: String, enum: ["AI","Software Engineering","Design","Web","Others"], default: "Others" },
  readTime: { type: Number },
  image: { type: String },
}, { timestamps: true });

export default mongoose.model("Article", articleSchema);
