import type { Response } from "express";

interface SendResponseOptions<T> {
  res: Response;
  statusCode?: number;
  message: string;
  data?: T;
}

export function sendResponse<T>({
  res,
  statusCode = 200,
  message,
  data,
}: SendResponseOptions<T>): void {
  res.status(statusCode).json({
    success: true,
    message,
    data: data ?? null,
  });
}