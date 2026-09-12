import { Router } from "express";
import userRouter from "../services/users.js";
import productRouter from "../services/products.js";

const router = Router();


router.use("/users", userRouter);

router.use("/products", productRouter);

export default router;