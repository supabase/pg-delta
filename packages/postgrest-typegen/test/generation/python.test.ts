import { describe, expect, test } from "bun:test";

import { generatePython as rawGeneratePython } from "../../src/generation/python.ts";
import { sortGeneratorMetadata } from "../../src/sort.ts";
import {
  addressCompositeType,
  baseColumn,
  baseMaterializedView,
  baseTable,
  baseView,
  buildMetadata,
  textType,
  userStatusEnum,
} from "./fixtures.ts";

// Generators expect pre-sorted metadata (the caller applies the canonical sort
// pass); mirror that here so fixture construction order doesn't matter.
const generatePython = (metadata: Parameters<typeof rawGeneratePython>[0]) =>
  rawGeneratePython(sortGeneratorMetadata(metadata));

describe("python typegen", () => {
  test("table with nullability, identity, generated and default columns", () => {
    const result = generatePython(
      buildMetadata({
        tables: [baseTable()],
        columns: [
          baseColumn({
            name: "id",
            format: "int8",
            is_identity: true,
            ordinal_position: 1,
          }),
          baseColumn({
            name: "status",
            format: "user_status",
            is_nullable: true,
            ordinal_position: 2,
          }),
          baseColumn({ name: "label", format: "text", ordinal_position: 3 }),
          baseColumn({
            name: "computed",
            format: "text",
            is_generated: true,
            ordinal_position: 4,
          }),
          baseColumn({
            name: "with_default",
            format: "int4",
            default_value: "0",
            ordinal_position: 5,
          }),
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "from __future__ import annotations

      import datetime
      import uuid
      from typing import (
          Annotated,
          Any,
          List,
          Literal,
          NotRequired,
          Optional,
          TypeAlias,
          TypedDict,
      )

      from pydantic import BaseModel, Field, Json

      PublicUserStatus: TypeAlias = Literal["ACTIVE", "INACTIVE"]

      class PublicTickets(BaseModel):
          computed: str = Field(alias="computed")
          id: int = Field(alias="id")
          label: str = Field(alias="label")
          status: Optional[PublicUserStatus] = Field(alias="status")
          with_default: int = Field(alias="with_default")

      class PublicTicketsInsert(TypedDict):
          computed: Annotated[str, Field(alias="computed")]
          id: NotRequired[Annotated[int, Field(alias="id")]]
          label: Annotated[str, Field(alias="label")]
          status: NotRequired[Annotated[Optional[PublicUserStatus], Field(alias="status")]]
          with_default: NotRequired[Annotated[int, Field(alias="with_default")]]

      class PublicTicketsUpdate(TypedDict):
          computed: NotRequired[Annotated[str, Field(alias="computed")]]
          id: NotRequired[Annotated[int, Field(alias="id")]]
          label: NotRequired[Annotated[str, Field(alias="label")]]
          status: NotRequired[Annotated[Optional[PublicUserStatus], Field(alias="status")]]
          with_default: NotRequired[Annotated[int, Field(alias="with_default")]]"
    `);
  });

  test("views and materialized views", () => {
    const result = generatePython(
      buildMetadata({
        tables: [baseTable({ id: 1, name: "tickets" })],
        views: [baseView({ id: 2, name: "tickets_view" })],
        materializedViews: [
          baseMaterializedView({ id: 3, name: "tickets_mv" }),
        ],
        columns: [
          baseColumn({ table_id: 1, name: "a", format: "text" }),
          baseColumn({
            table_id: 2,
            name: "b",
            format: "int4",
            is_nullable: true,
          }),
          baseColumn({ table_id: 3, name: "c", format: "bool" }),
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "from __future__ import annotations

      import datetime
      import uuid
      from typing import (
          Annotated,
          Any,
          List,
          Literal,
          NotRequired,
          Optional,
          TypeAlias,
          TypedDict,
      )

      from pydantic import BaseModel, Field, Json

      PublicUserStatus: TypeAlias = Literal["ACTIVE", "INACTIVE"]

      class PublicTickets(BaseModel):
          a: str = Field(alias="a")

      class PublicTicketsInsert(TypedDict):
          a: Annotated[str, Field(alias="a")]

      class PublicTicketsUpdate(TypedDict):
          a: NotRequired[Annotated[str, Field(alias="a")]]

      class PublicTicketsView(BaseModel):
          b: Optional[int] = Field(alias="b")

      class PublicTicketsMv(BaseModel):
          c: bool = Field(alias="c")"
    `);
  });

  test("enum alias and composite type", () => {
    const result = generatePython(
      buildMetadata({
        types: [userStatusEnum, textType, addressCompositeType],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "from __future__ import annotations

      import datetime
      import uuid
      from typing import (
          Annotated,
          Any,
          List,
          Literal,
          NotRequired,
          Optional,
          TypeAlias,
          TypedDict,
      )

      from pydantic import BaseModel, Field, Json

      PublicUserStatus: TypeAlias = Literal["ACTIVE", "INACTIVE"]







      class PublicAddress(BaseModel):
          street: str = Field(alias="street")
          city: str = Field(alias="city")"
    `);
  });

  test("array column resolves to List[...] and multi-word names are normalized", () => {
    const result = generatePython(
      buildMetadata({
        tables: [baseTable()],
        columns: [
          baseColumn({
            name: "tags",
            format: "_user_status",
            is_nullable: false,
          }),
          baseColumn({ name: "names", format: "_text", is_nullable: true }),
          baseColumn({ name: "victory road", format: "text" }),
        ],
      }),
    );

    expect(result).toMatchInlineSnapshot(`
      "from __future__ import annotations

      import datetime
      import uuid
      from typing import (
          Annotated,
          Any,
          List,
          Literal,
          NotRequired,
          Optional,
          TypeAlias,
          TypedDict,
      )

      from pydantic import BaseModel, Field, Json

      PublicUserStatus: TypeAlias = Literal["ACTIVE", "INACTIVE"]

      class PublicTickets(BaseModel):
          names: Optional[List[str]] = Field(alias="names")
          tags: List[PublicUserStatus] = Field(alias="tags")
          victory_road: str = Field(alias="victory road")

      class PublicTicketsInsert(TypedDict):
          names: NotRequired[Annotated[Optional[List[str]], Field(alias="names")]]
          tags: Annotated[List[PublicUserStatus], Field(alias="tags")]
          victory_road: Annotated[str, Field(alias="victory road")]

      class PublicTicketsUpdate(TypedDict):
          names: NotRequired[Annotated[Optional[List[str]], Field(alias="names")]]
          tags: NotRequired[Annotated[List[PublicUserStatus], Field(alias="tags")]]
          victory_road: NotRequired[Annotated[str, Field(alias="victory road")]]"
    `);
  });
});
