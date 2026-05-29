import { Request, Response, NextFunction } from 'express';

export function requireFields(...fields: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const missing = fields.filter(f => {
      const val = req.body?.[f];
      return val === undefined || val === null || val === '';
    });
    if (missing.length > 0) {
      res.status(400).json({ 
        error: `缺少必填字段: ${missing.join(', ')}`,
        missing 
      });
      return;
    }
    next();
  };
}

export function validateId(paramName: string = 'id') {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.params[paramName];
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      res.status(400).json({ error: '无效的ID参数' });
      return;
    }
    next();
  };
}

export function validateBodySize(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const size = JSON.stringify(req.body || {}).length;
    if (size > maxBytes) {
      res.status(400).json({ error: '请求体过大' });
      return;
    }
    next();
  };
}
