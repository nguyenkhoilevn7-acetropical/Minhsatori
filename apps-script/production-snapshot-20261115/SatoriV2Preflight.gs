

function preflightSatoriV2() {
  const result = {
      botApiReady: typeof SatoriBotApi !== "undefined",
          exactReaderReady:
                typeof SatoriInvoiceExactBatch !== "undefined",
                    pdfReaderReady:
                          typeof SatoriCustomerPdfRead !== "undefined",
                              ordersPermission: false,
                                  pdfPermission: false,
                                      archiveAccessible: false,
                                          archiveHasPdf: false,
                                              exactReadPass: false
                                                };

                                                  try {
                                                      const props = PropertiesService.getScriptProperties();

                                                          const clients = JSON.parse(
                                                                props.getProperty("SATORI_BOT_CLIENTS_JSON") || "{}"
                                                                    );

                                                                        const hasScope = scope =>
                                                                              Object.values(clients).some(c =>
                                                                                      c &&
                                                                                              c.enabled !== false &&
                                                                                                      Array.isArray(c.scopes) &&
                                                                                                              c.scopes.includes(scope) &&
                                                                                                                      typeof c.secret === "string" &&
                                                                                                                              c.secret.length >= 32
                                                                                                                                    );

                                                                                                                                        result.ordersPermission = hasScope("orders:read");
                                                                                                                                            result.pdfPermission = hasScope("pdf:read");

                                                                                                                                                const folderId = props.getProperty(
                                                                                                                                                      "SATORI_PDF_ARCHIVE_FOLDER_ID"
                                                                                                                                                          );

                                                                                                                                                              if (folderId) {
                                                                                                                                                                    try {
                                                                                                                                                                            const folder = DriveApp.getFolderById(folderId);
                                                                                                                                                                                    folder.getName();
                                                                                                                                                                                            result.archiveAccessible = true;
                                                                                                                                                                                                    result.archiveHasPdf =
                                                                                                                                                                                                              folder.getFilesByType(MimeType.PDF).hasNext();
                                                                                                                                                                                                                    } catch (e) {
                                                                                                                                                                                                                            result.archiveAccessible = false;
                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                      }

                                                                                                                                                                                                                                          const state = readState_();
                                                                                                                                                                                                                                              const orders = JSON.parse(
                                                                                                                                                                                                                                                    state.values.satori_orders_v15 || "[]"
                                                                                                                                                                                                                                                        );

                                                                                                                                                                                                                                                            result.revision = state.revision;
                                                                                                                                                                                                                                                                result.invoiceCount = orders.length;

                                                                                                                                                                                                                                                                    const sample = orders.find(o =>
                                                                                                                                                                                                                                                                          o &&
                                                                                                                                                                                                                                                                                Number.isSafeInteger(Number(o.invoiceNo)) &&
                                                                                                                                                                                                                                                                                      /^[A-Za-z0-9_-]{1,80}$/.test(String(o.id))
                                                                                                                                                                                                                                                                                          );

                                                                                                                                                                                                                                                                                              if (sample && result.exactReaderReady) {
                                                                                                                                                                                                                                                                                                    const response = SatoriInvoiceExactBatch.read(
                                                                                                                                                                                                                                                                                                            state,
                                                                                                                                                                                                                                                                                                                    {
                                                                                                                                                                                                                                                                                                                              refs: [{
                                                                                                                                                                                                                                                                                                                                          invoiceNo: Number(sample.invoiceNo),
                                                                                                                                                                                                                                                                                                                                                      id: String(sample.id)
                                                                                                                                                                                                                                                                                                                                                                }]
                                                                                                                                                                                                                                                                                                                                                                        }
                                                                                                                                                                                                                                                                                                                                                                              );

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
                                                                                                                                                                                                                                                                    
           }                                                                                                                                                                                                                                                                                                                                                                         result.exactReadPass =
                                                                                                                                                                                                                                                                                                                                                                                            response.orders.length === 1 &&
                                                                                                                                                                                                                                                                                                                                                                                                    !response.orders[0].missing;
                                                                                                                                                                                                                                                                                                                                                                                                        }

                                                                                                                                                                                                                                                                                                                                                                                                          } catch (e) {
                                                                                                                                                                                                                                                                                                                                                                                                              result.error = String(
                                                                                                                                                                                                                                                                                                                                                                                                                    e.code || "PREFLIGHT_ERROR"
                                                                                                                                                                                                                                                                                                                                                                                                                        );
                                                                                                                                                                                                                                                                                                                                                                                                                          }

                                                                                                                                                                                                                                                                                                                                                                                                                            Logger.log(JSON.stringify(result, null, 2));
                                                                                                                                                                                                                                                                                                                                                                                                                              return result;
                                                                                                                                                                                                                                                                                                                                                                                                                              }

                                                                                                                                                                                                                                                                                                                                                                                                                              
