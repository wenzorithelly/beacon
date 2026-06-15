import { describe, expect, it } from "bun:test";
import { extractModelSchema } from "@/intel/extractors/models";
import { isSchemaCandidate } from "@/intel/schema-candidates";

// Spring Boot / JPA entities must map onto the /db board like the other ORMs. The bug this covers:
// a Spring project (~50 @Entity classes) mapped only the handful the agent read by hand at init,
// because there was no deterministic Java/JPA extractor at all.

describe("extractModelSchema — JPA", () => {
  it("maps an @Entity with @Table(name), @Id, and @Column fields", () => {
    const file = {
      path: "src/main/java/com/acme/VturtbUser.java",
      content: `
package com.acme;
import javax.persistence.*;

@Entity
@Table(name = "VTURTB_USER")
public class VturtbUser {
    @Id
    @Column(name = "USER_ID")
    private Long userId;

    @Column(name = "EMAIL", nullable = false)
    private String email;

    @Column(name = "ACTIVE")
    private Boolean active;
}
`,
    };
    const { tables } = extractModelSchema([file]);
    const t = tables.find((t) => t.name === "VTURTB_USER");
    expect(t).toBeTruthy();
    const names = t!.columns.map((c) => c.name);
    expect(names).toEqual(["USER_ID", "EMAIL", "ACTIVE"]);
    expect(t!.columns.find((c) => c.name === "USER_ID")?.isPk).toBe(true);
    expect(t!.columns.find((c) => c.name === "EMAIL")?.type).toBe("varchar");
    expect(t!.columns.find((c) => c.name === "EMAIL")?.nullable).toBe(false);
    expect(t!.columns.find((c) => c.name === "ACTIVE")?.type).toBe("boolean");
  });

  it("falls back to the class name when @Table is absent and the column name to the field name", () => {
    const file = {
      path: "src/main/java/Order.java",
      content: `
@Entity
public class Order {
    @Id
    private java.util.UUID id;
    private String status;
    @Transient
    private String ignored;
}
`,
    };
    const { tables } = extractModelSchema([file]);
    const t = tables.find((t) => t.name === "Order");
    expect(t).toBeTruthy();
    expect(t!.columns.map((c) => c.name)).toEqual(["id", "status"]); // @Transient skipped
    expect(t!.columns.find((c) => c.name === "id")?.type).toBe("uuid");
  });

  it("emits an FK column + relation for @ManyToOne + @JoinColumn", () => {
    const files = [
      {
        path: "src/main/java/Customer.java",
        content: `
@Entity
@Table(name = "customers")
public class Customer {
    @Id @Column(name = "id") private Long id;
}
`,
      },
      {
        path: "src/main/java/Invoice.java",
        content: `
@Entity
@Table(name = "invoices")
public class Invoice {
    @Id @Column(name = "id") private Long id;

    @ManyToOne
    @JoinColumn(name = "customer_id")
    private Customer customer;
}
`,
      },
    ];
    const { tables, relations } = extractModelSchema(files);
    const inv = tables.find((t) => t.name === "invoices");
    expect(inv!.columns.find((c) => c.name === "customer_id")?.isFk).toBe(true);
    expect(relations).toContainEqual({
      fromTable: "invoices",
      fromColumn: "customer_id",
      toTable: "customers",
      toColumn: "id",
    });
  });

  it("ignores non-entity Java classes", () => {
    const file = {
      path: "src/main/java/Helper.java",
      content: `public class Helper { private String name; }`,
    };
    expect(extractModelSchema([file]).tables).toEqual([]);
  });
});

describe("isSchemaCandidate — Java", () => {
  it("treats .java files as schema candidates (they may hold @Entity classes)", () => {
    expect(isSchemaCandidate("src/main/java/com/acme/VturtbUser.java")).toBe(true);
  });
  it("still excludes Java test files", () => {
    expect(isSchemaCandidate("src/test/java/com/acme/VturtbUserTest.java")).toBe(false);
  });
});
