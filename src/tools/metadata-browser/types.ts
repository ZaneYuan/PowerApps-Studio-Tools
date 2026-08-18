export interface LabelValue {
  UserLocalizedLabel?: { Label: string } | null;
}

export interface EntitySummary {
  MetadataId: string;
  LogicalName: string;
  SchemaName: string;
  DisplayName: LabelValue | null;
  ObjectTypeCode: number;
  IsCustomEntity: boolean;
  EntitySetName: string;
}

export interface AttributeSummary {
  MetadataId: string;
  LogicalName: string;
  SchemaName: string;
  DisplayName: LabelValue | null;
  AttributeType: string;
  RequiredLevel?: { Value: string } | null;
  IsCustomAttribute: boolean;
  IsPrimaryId: boolean;
  Description?: LabelValue | null;
  /** Non-null on a compound field's own child attributes (e.g. `address1_line1`), naming the
   *  parent composite attribute — null for everything else. */
  AttributeOf?: string | null;
  IsValidForCreate: boolean;
  IsValidForUpdate: boolean;
  IsValidForRead: boolean;
  IsFilterable: boolean;
  IsSearchable: boolean;
}

export interface RelationshipSummary {
  MetadataId: string;
  SchemaName: string;
  ReferencingEntity?: string;
  ReferencingAttribute?: string;
  ReferencedEntity?: string;
  ReferencedAttribute?: string;
  Entity1LogicalName?: string;
  Entity2LogicalName?: string;
  IntersectEntityName?: string;
}

export function labelOf(label: LabelValue | null | undefined, fallback: string): string {
  return label?.UserLocalizedLabel?.Label || fallback;
}

export type TabKey = "attributes" | "oneToMany" | "manyToOne" | "manyToMany";

export const TAB_LABELS: Record<TabKey, string> = {
  attributes: "字段 Attributes",
  oneToMany: "1:N 关系",
  manyToOne: "N:1 关系",
  manyToMany: "N:N 关系",
};

export const RELATIONSHIP_COLLECTION: Record<Exclude<TabKey, "attributes">, string> = {
  oneToMany: "OneToManyRelationships",
  manyToOne: "ManyToOneRelationships",
  manyToMany: "ManyToManyRelationships",
};
