import { Module } from '@nestjs/common';

import { ObjectStorage } from './object-storage.js';

@Module({
  providers: [ObjectStorage],
  exports: [ObjectStorage],
})
export class StorageModule {}
