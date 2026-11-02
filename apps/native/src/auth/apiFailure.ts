/** A failed request; status zero includes an interrupted or timed-out response. */
export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }

  get offline() {
    return this.status === 0;
  }
}
