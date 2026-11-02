import { UploadTicket } from "@repo/contracts";
import { z } from "zod";

const reservation = z.union([
  z.object({ documentId: z.uuid() }).transform((answer) => answer.documentId),
  UploadTicket.transform((answer) => answer.document.id),
]);

// Older receipts stored a whole ticket; current receipts retain only its document ID.
export const savedReservationId = (answer: unknown) =>
  reservation.parse(answer);
