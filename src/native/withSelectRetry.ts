const UNKNOWN_PROPERTY_RE = /Could not find a property named '([^']+)'/i;

/** `EntityDefinitions/Attributes` metadata can list an attribute the live OData $metadata model
 *  doesn't actually expose — seen in practice on system entities like `quote`, presumably a
 *  metadata/EDM sync quirk in that org, not something predictable ahead of time, and on wide
 *  entities more than one field can be affected. Rather than fail the whole request over a bad
 *  field, drop it from `fields` (typically a $select list) and retry — one field per round trip,
 *  since Dataverse only ever reports the single field that broke a given request. No fixed
 *  attempt cap: each round either removes exactly one field (bounded by the field count, so this
 *  always terminates) or makes no progress, in which case the real Dataverse error is rethrown
 *  as-is instead of being masked by a generic "gave up" message. */
export async function withSelectRetry<T>(fields: string[], run: (fields: string[]) => Promise<T>): Promise<T> {
  let current = fields;
  while (true) {
    try {
      return await run(current);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const match = message.match(UNKNOWN_PROPERTY_RE);
      if (!match) throw err;
      const next = current.filter((f) => f.toLowerCase() !== match[1].toLowerCase());
      if (next.length === current.length) throw err; // nothing removed — avoid looping forever
      current = next;
    }
  }
}
