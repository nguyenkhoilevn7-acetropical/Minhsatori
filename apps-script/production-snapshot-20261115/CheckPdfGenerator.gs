function checkPdfGenerator() {
    const props = PropertiesService.getScriptProperties();

      const archiveInstalled =
          typeof SatoriInvoicePdfArchive !== "undefined";

            const pendingSupported =
                archiveInstalled &&
                    typeof SatoriInvoicePdfArchive.pending === "function";

                      const generatorInstalled =
                          typeof SatoriPdfHeadless !== "undefined" &&
                              typeof SatoriPdfHeadless.tick === "function";

                                const rendererConfigured =
                                    !!props.getProperty("SATORI_PDF_RENDER_SECRET");

                                      const triggers = ScriptApp.getProjectTriggers();

                                        const triggerInstalled = triggers.some(
                                            t => t.getHandlerFunction() === "satoriPdfHeadlessTick"
                                              );

                                                const result = {
                                                    archiveInstalled,
                                                        pendingSupported,
                                                            generatorInstalled,
                                                                rendererConfigured,
                                                                    triggerInstalled,
                                                                        pendingCount: null,
                                                                            pendingInvoices: []
                                                                              };

                                                                                if (pendingSupported) {
                                                                                    try {
                                                                                          const state = readState_();

                                                                                                const queue = SatoriInvoicePdfArchive.pending(
                                                                                                        state,
                                                                                                                { limit: 4 }
                                                                                                                      );

                                                                                                                            result.pendingCount = queue.jobs.length;

                                                                                                                                  result.pendingInvoices = queue.jobs.map(
                                                                                                                                          job => Number(job.order.invoiceNo)
                                                                                                                                                );

                                                                                                                                                    } catch (err) {
                                                                                                                                                          result.pendingError =
                                                                                                                                                                  String(err.message || err);
                                                                                                                                                                      }
                                                                                                                                                                        }

                                                                                                                                                                          console.log(JSON.stringify(result, null, 2));

                                                                                                                                                                            return result;
                                                                                                                                                                            }

