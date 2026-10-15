/** A changed read head is not permission to resend a model request. */
export class TtrpgOpenReadConflictV1 extends Error {
  constructor(message: string) { super(message) }
}
