
function taoKhoaGeminiOwnerMotLan() {
  const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('SATORI_BOT_CLIENTS_JSON');
    
      if (!raw) {
          throw new Error('Không tìm thấy cấu hình Bot API');
            }
            
              const clients = JSON.parse(raw);
              
                if (!clients || typeof clients !== 'object' ||
                      Array.isArray(clients)) {
                          throw new Error('Cấu hình JSON không hợp lệ');
                            }
                            
                              const id = 'gemini_owner_writer_2026';
                              
                                if (Object.prototype.hasOwnProperty.call(clients, id)) {
                                    throw new Error('Khóa Gemini đã tồn tại. Không tạo đè.');
                                      }
                                      
                                        const secret =
                                            Utilities.getUuid().replace(/-/g, '') +
                                                Utilities.getUuid().replace(/-/g, '');
                                                
                                                  clients[id] = {
                                                      enabled: true,
                                                          secret: secret,
                                                              scopes: [
                                                                    'orders:read',
                                                                          'catalogue:read',
                                                                                'orders:write'
                                                                                    ]
                                                                                      };
                                                                                      
                                                                                        props.setProperties({
                                                                                            SATORI_BOT_CLIENTS_JSON: JSON.stringify(clients),
                                                                                                SATORI_GEMINI_OWNER_SECRET: secret
                                                                                                  }, false);
                                                                                                  
                                                                                                    console.log('OK - Da tao khoa Gemini Owner thanh cong.');
                                                                                                    }
                                                                                                     {
  
}
