
import dotenv from "dotenv";
import app from "./App.js";
import connectDB from "./components/config/Db.js";

dotenv.config();

const PORT = process.env.PORT || 4000;

const startServer = async () => {
  try {
    await connectDB();
    console.log("Database connected");

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

