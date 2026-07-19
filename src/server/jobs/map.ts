import type { JobDTO } from '../../contracts/index.ts';
import { JobDtoSchema } from '../../contracts/index.ts';
import type { JobRecord } from '../../queue/types.ts';

/**
 * `JobRecord` (`src/queue/types.ts`) -> `JobDTO` (wire) — a straight
 * passthrough: field names already match, and the wire enums
 * (`JobKindWire`/`JobPriorityWire`/`JobStatusWire`) are isomorphic string
 * values with their queue counterparts (guarded by
 * `tests/contracts/job-kind-parity.test.ts`), so routing the record through
 * `JobDtoSchema.parse` both validates that parity at the boundary and hands
 * back the correctly-typed `JobDTO` with no manual per-field enum cast.
 */
export function toJobDto(record: JobRecord): JobDTO {
  return JobDtoSchema.parse(record);
}
