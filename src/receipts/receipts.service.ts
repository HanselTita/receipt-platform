import { Injectable } from '@nestjs/common';

import { CreateReceiptDto } from './dto/create-receipt.dto';

@Injectable()
export class ReceiptsService {
  async create(userId: string, dto: CreateReceiptDto) {
    return {
      message: 'Receipt creation coming next lesson.',
      createdBy: userId,
      receivedItems: dto.items.length,
    };
  }
}
