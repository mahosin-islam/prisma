import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError.js";

export function roleMiddleware(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError("Unauthorized: Please login first", 401));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          `Forbidden: Only ${allowedRoles.join(", ")} can access this`,
          403
        )
      );
    }

    next();
  };
}