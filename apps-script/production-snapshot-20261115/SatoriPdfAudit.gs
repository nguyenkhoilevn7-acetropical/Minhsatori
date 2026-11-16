function auditSatoriPdfLatest() {
    const state = readState_();

      const orders = JSON.parse(
          state.values.satori_orders_v15 || "[]"
            );

              const sample = orders
                  .filter(o =>
                        o &&
                              Number.isSafeInteger(Number(o.invoiceNo)) &&
                                    Number.isSafeInteger(Number(o.total)) &&
                                          o.status !== "Đã hủy" &&
                                                o.status !== "Không Tính"
                                                    )
                                                        .sort((a, b) =>
                                                              Number(b.invoiceNo) - Number(a.invoiceNo)
                                                                  )
                                                                      .slice(0, 3);

                                                                        const results = sample.map(o => {
                                                                            try {
                                                                                  const pdf = SatoriCustomerPdfRead.read(
                                                                                          state,
                                                                                                  {
                                                                                                            invoiceNo: Number(o.invoiceNo),
                                                                                                                      id: String(o.id),
                                                                                                                                expectedTotal: Number(o.total)
                                                                                                                                        }
                                                                                                                                              );

                                                                                                                                                    return {
                                                                                                                                                            invoiceNo: Number(o.invoiceNo),
                                                                                                                                                                    status: "PDF_VERIFIED",
                                                                                                                                                                            version: pdf.versionHash
                                                                                                                                                                                  };

                                                                                                                                                                                      } catch (err) {
                                                                                                                                                                                            return {
                                                                                                                                                                                                    invoiceNo: Number(o.invoiceNo),
                                                                                                                                                                                                            status: err.code || "PDF_READ_FAILED"
                                                                                                                                                                                                                  };
                                                                                                                                                                                                                      }
                                                                                                                                                                                                                        });

                                                                                                                                                                                                                          const report = {
                                                                                                                                                                                                                              revision: state.revision,
                                                                                                                                                                                                                                  checked: results.length,
                                                                                                                                                                                                                                      verified: results.filter(
                                                                                                                                                                                                                                            x => x.status === "PDF_VERIFIED"
                                                                                                                                                                                                                                                ).length,
                                                                                                                                                                                                                                                    results
                                                                                                                                                                                                                                                      };

                                                                                                                                                                                                                                                        console.log(JSON.stringify(report, null, 2));
                                                                                                                                                                                                                                                          return report;
                                                                                                                                                                                                                                                          }

