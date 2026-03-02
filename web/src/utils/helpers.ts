export const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency: "SGD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

export const formatYears = (n: number) => `${n} ${n === 1 ? "Year" : "Years"}`;