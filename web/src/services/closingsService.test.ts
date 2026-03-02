import { beforeEach, describe, expect, it, vi } from "vitest";

const { authJsonMock } = vi.hoisted(() => ({
  authJsonMock: vi.fn(),
}));

vi.mock("./authService", () => ({
  authJson: (...args: unknown[]) => authJsonMock(...args),
}));

import {
  closingsService,
  getAnnualizedFYP,
  getFYC,
  type ClosingInput,
} from "./closingsService";

describe("closingsService", () => {
  beforeEach(() => {
    authJsonMock.mockReset();
  });

  it("calculates GST-aware annualized premium and commission values", () => {
    expect(getAnnualizedFYP(109, "Annual", 9)).toBe(100);
    expect(getAnnualizedFYP(25, "Quarterly")).toBe(100);

    expect(getFYC(109, "Annual", 10, 9)).toBe(10);
    expect(getFYC(100, "Mthly-2", 10)).toBe(20);
  });

  it("loads closings sorted by timestamp and normalizes nested payloads", async () => {
    authJsonMock.mockResolvedValue({
      closings: [
        {
          id: 1,
          timestamp: "2026-02-03T08:00:00.000Z",
          fscCode: " FSC-1 ",
          fscName: " Agent One ",
          sourceId: "warm",
          sourceLabel: "Warm",
          referrals: 1,
          items: [
            {
              isRider: false,
              productId: "PLAN-1",
              fullName: "Starter Plan",
              shortName: "SP",
              premiumTermOrIssueAge: " 20 years ",
              type: " savings ",
              fycRate: "12.5",
              gst: "9",
              frequencies: ["Annual", "Quarterly"],
              quantitiesAndPremiums: [
                {
                  quantity: "2",
                  premium: "109.5",
                  frequency: "Annual",
                },
              ],
              riders: [
                {
                  isRider: true,
                  productId: "RIDER-1",
                  fullName: "Booster Rider",
                  shortName: "BR",
                  fycRate: "4",
                  gst: 0,
                  quantitiesAndPremiums: [
                    {
                      quantity: 1,
                      premium: 20,
                      frequency: "Annual",
                    },
                  ],
                  riders: [],
                },
              ],
            },
            {
              productId: "",
              fullName: "Ignored Item",
              quantitiesAndPremiums: [],
              riders: [],
            },
          ],
        },
        {
          id: 2,
          timestamp: "2026-02-10T08:00:00.000Z",
          fscCode: "FSC-2",
          fscName: "Agent Two",
          sharedFscCode: "FSC-3",
          sharedFscName: "Agent Three",
          sourceId: "referral",
          sourceLabel: "Referral",
          sourceItemId: "  42  ",
          sourceItemLabel: "  Expo 1  ",
          sourceComment: "  From seminar  ",
          referrals: -5,
          referralsComment: "  Interested spouse  ",
          updatedBy: "  Manager  ",
          updatedAt: "2026-02-11T09:00:00.000Z",
          items: [],
        },
      ],
    });

    const closings = await closingsService.getClosings({
      startDate: "2026-02-01T00:00:00.000Z",
      endDate: "2026-03-01T00:00:00.000Z",
      fscCode: "FSC-3",
    });

    expect(closings.map((closing) => closing.id)).toEqual(["2", "1"]);
    expect(closings[0]).toMatchObject({
      id: "2",
      fscCode: "FSC-2",
      fscName: "Agent Two",
      isShared: true,
      sharedFscCode: "FSC-3",
      sharedFscName: "Agent Three",
      sourceId: "referral",
      sourceLabel: "Referral",
      sourceItemId: "42",
      sourceItemLabel: "Expo 1",
      sourceComment: "From seminar",
      referrals: 0,
      referralsComment: "Interested spouse",
      updatedBy: "Manager",
      updatedAt: "2026-02-11T09:00:00.000Z",
      items: [],
    });
    expect(closings[0].timestamp).toBeInstanceOf(Date);

    expect(closings[1]).toMatchObject({
      id: "1",
      fscCode: "FSC-1",
      fscName: "Agent One",
      isShared: false,
      items: [
        {
          productId: "PLAN-1",
          fullName: "Starter Plan",
          shortName: "SP",
          premiumTermOrIssueAge: "20 years",
          type: "savings",
          fycRate: 12.5,
          gst: 9,
          frequencies: ["Annual", "Quarterly"],
          quantitiesAndPremiums: [
            {
              quantity: 2,
              premium: 109.5,
              frequency: "Annual",
            },
          ],
          riders: [
            {
              productId: "RIDER-1",
              fullName: "Booster Rider",
              shortName: "BR",
              fycRate: 4,
              gst: 0,
              quantitiesAndPremiums: [
                {
                  quantity: 1,
                  premium: 20,
                  frequency: "Annual",
                },
              ],
              riders: [],
            },
          ],
        },
      ],
    });
    expect(closings[1].timestamp).toBeInstanceOf(Date);

    expect(authJsonMock).toHaveBeenCalledWith(
      "/api/closings?startDate=2026-02-01T00%3A00%3A00.000Z&endDate=2026-03-01T00%3A00%3A00.000Z&fscCode=FSC-3",
      { method: "GET" },
      { defaultErrorMessage: "Request failed" },
    );
  });

  it("returns null when the backend reports a missing closing", async () => {
    authJsonMock.mockRejectedValue(new Error("Closing not found"));

    await expect(closingsService.getClosingById("404")).resolves.toBeNull();
  });

  it("serializes create requests, backups, and month payloads", async () => {
    const closing: ClosingInput = {
      timestamp: new Date("2026-02-12T08:30:00.000Z"),
      fscCode: " FSC-8 ",
      fscName: "Agent Eight",
      sharedFscCode: " FSC-9 ",
      sharedFscName: " Agent Nine ",
      sourceId: " seminar ",
      sourceItemId: "  7  ",
      sourceComment: " Walk-in lead ",
      referrals: 2,
      referralsComment: " Warm circle ",
      items: [
        {
          isRider: false,
          productId: "PLAN-8",
          fullName: " Legacy Plan ",
          shortName: "LP",
          premiumTermOrIssueAge: " 15 years ",
          type: " savings ",
          fycRate: 12,
          gst: 9,
          quantitiesAndPremiums: [
            {
              quantity: 2,
              premium: 100,
              frequency: "Annual",
            },
          ],
          riders: [
            {
              isRider: true,
              productId: "RIDER-8",
              fullName: "Booster",
              shortName: "BR",
              fycRate: 5,
              gst: 0,
              quantitiesAndPremiums: [
                {
                  quantity: 1,
                  premium: 20,
                  frequency: "Single",
                },
              ],
              riders: [],
            },
          ],
        },
      ],
    };

    authJsonMock.mockResolvedValueOnce({ id: 81 });

    await expect(closingsService.createClosing(closing)).resolves.toBe("81");

    const [createPath, createInit, createOptions] = authJsonMock.mock.calls[0] as [
      string,
      { method: string; body: string },
      { defaultErrorMessage: string },
    ];

    expect(createPath).toBe("/api/closings");
    expect(createInit.method).toBe("POST");
    expect(createOptions).toEqual({ defaultErrorMessage: "Request failed" });
    expect(JSON.parse(createInit.body)).toEqual({
      timestamp: "2026-02-12T08:30:00.000Z",
      fscCode: "FSC-8",
      fscName: "Agent Eight",
      isShared: true,
      sharedFscCode: "FSC-9",
      sharedFscName: "Agent Nine",
      sourceId: "seminar",
      sourceItemId: "7",
      sourceComment: " Walk-in lead ",
      referrals: 2,
      referralsComment: " Warm circle ",
      items: [
        {
          isRider: false,
          productId: "PLAN-8",
          fullName: "Legacy Plan",
          shortName: "LP",
          premiumTermOrIssueAge: "15 years",
          type: "savings",
          fycRate: 12,
          gst: 9,
          quantitiesAndPremiums: [
            {
              quantity: 2,
              premium: 100,
              frequency: "Annual",
            },
          ],
          riders: [
            {
              isRider: true,
              productId: "RIDER-8",
              fullName: "Booster",
              shortName: "BR",
              fycRate: 5,
              gst: 0,
              quantitiesAndPremiums: [
                {
                  quantity: 1,
                  premium: 20,
                  frequency: "Single",
                },
              ],
              riders: [],
            },
          ],
        },
      ],
    });

    authJsonMock.mockResolvedValueOnce({
      backups: [
        {
          id: 5,
          data: [{ foo: "bar" }],
          createdAt: "2026-02-13T00:00:00.000Z",
          expiresAt: "invalid",
          createdBy: "  Manager  ",
        },
        {
          id: "",
          data: "[]",
        },
      ],
    });

    await expect(closingsService.getBackupsForMonth("202602")).resolves.toEqual([
      {
        id: "5",
        monthKey: "202602",
        data: '[{"foo":"bar"}]',
        createdAt: new Date("2026-02-13T00:00:00.000Z"),
        expiresAt: undefined,
        createdBy: "Manager",
      },
    ]);

    authJsonMock.mockResolvedValueOnce({
      data: [{ month: "February" }],
    });

    await expect(closingsService.getMonthData("202602")).resolves.toBe(
      '[{"month":"February"}]',
    );

    authJsonMock.mockResolvedValueOnce({ saved: true });

    await expect(
      closingsService.setMonthData("202602", '[{"month":"February"}]'),
    ).resolves.toBeUndefined();

    const [setPath, setInit] = authJsonMock.mock.calls[3] as [
      string,
      { method: string; body: string },
    ];
    expect(setPath).toBe("/api/closings/months/202602/data");
    expect(setInit.method).toBe("PUT");
    expect(JSON.parse(setInit.body)).toEqual({
      data: '[{"month":"February"}]',
    });
  });

  it("rejects invalid identifiers before issuing update and delete requests", async () => {
    await expect(
      closingsService.updateClosing({
        id: "",
      } as never),
    ).rejects.toThrow("Invalid closing ID");

    await expect(closingsService.deleteClosing("")).rejects.toThrow(
      "Invalid closing ID",
    );

    await expect(closingsService.deleteBackup("")).rejects.toThrow(
      "Invalid backup ID",
    );
  });
});
