import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class UpdateBranchAssignmentsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  branchIds: string[];
}
