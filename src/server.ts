import cors from "cors";
import express from "express";
import dotenv from "dotenv";

import app from "./app.js";

dotenv.config(); 

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on The port http://localhost:${PORT}`);
});