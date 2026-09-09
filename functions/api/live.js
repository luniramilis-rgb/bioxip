import { json } from "./_db.js";

export async function onRequestPost(context) {
  return json(
    {
      message:
        "live lookup (ChEMBL/PubChem/Open Targets) belum aktif - fase 3",
    },
    501,
  );
}
