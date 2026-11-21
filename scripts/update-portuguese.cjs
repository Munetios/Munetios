'use strict';
const fs = require('node:fs');
const path = require('node:path');
const folder = path.join(__dirname, '..', 'omniwrite', 'languages');
const base = JSON.parse(fs.readFileSync(path.join(folder, 'pt.json'), 'utf8'));
const br = {};
for (const [key, value] of Object.entries(base)) {
  if (typeof value !== 'string') continue;
  const translated = value.replace(/Pesquisar/g, 'Buscar').replace(/pesquisar/g, 'buscar').replace(/Pesquise/g, 'Busque').replace(/pesquise/g, 'busque').replace(/Pesquisando/g, 'Buscando').replace(/pesquisando/g, 'buscando');
  if (translated !== value) br[key] = translated;
}
Object.assign(br, { search: 'Buscar', search_documents: 'Buscar documentos...', search_fonts: 'Buscar fontes', ctx_search_documents: 'Buscar documentos', search_placeholder: 'Buscar documentos...', search_templates_placeholder: 'Buscar modelos…', icon_search_placeholder: 'Buscar ícones', settings: 'Configurações', settings_modal_title: 'Configurações', settings_nav_backup: 'Cópias de segurança', export_backup: 'Exportar cópia de segurança', import_backup: 'Importar cópia de segurança', backup_restore: 'Cópias de segurança e restauração', fmt_spoiler: 'Texto oculto' });
const pt = {};
const words = [
  ['Configurações','Ajustes'], ['configurações','ajustes'], ['Arquivos','Ficheiros'], ['arquivos','ficheiros'], ['Arquivo','Ficheiro'], ['arquivo','ficheiro'],
  ['Lixeira','Lixo'], ['lixeira','lixo'], ['Usuário','Utilizador'], ['usuário','utilizador'], ['Aplicativos','Aplicações'], ['aplicativos','aplicações'], ['Aplicativo','Aplicação'], ['aplicativo','aplicação'],
  ['Telas','Ecrãs'], ['telas','ecrãs'], ['Tela','Ecrã'], ['tela','ecrã'], ['Senha','Palavra-passe'], ['senha','palavra-passe'],
  ['Salvando','A guardar'], ['salvando','a guardar'], ['Salvar','Guardar'], ['salvar','guardar'], ['Salve','Guarde'], ['salve','guarde'], ['Salvos','Guardados'], ['salvos','guardados'], ['Salvas','Guardadas'], ['salvas','guardadas'], ['Salvo','Guardado'], ['salvo','guardado'], ['Salva','Guardada'], ['salva','guardada'],
  ['Carregando','A carregar'], ['carregando','a carregar'], ['Enviando','A enviar'], ['enviando','a enviar'], ['Baixando','A transferir'], ['baixando','a transferir'], ['Baixar','Transferir'], ['baixar','transferir'],
  ['Buscando','A pesquisar'], ['buscando','a pesquisar'], ['Buscar','Pesquisar'], ['buscar','pesquisar'], ['Busque','Pesquise'], ['busque','pesquise'],
  ['Compartilhamento','Partilha'], ['compartilhamento','partilha'], ['Compartilhar','Partilhar'], ['compartilhar','partilhar'], ['Compartilhe','Partilhe'], ['compartilhe','partilhe'], ['Compartilhado','Partilhado'], ['compartilhado','partilhado'],
  ['Excluindo','A eliminar'], ['excluindo','a eliminar'], ['Excluir','Eliminar'], ['excluir','eliminar'], ['Exclua','Elimine'], ['exclua','elimine'], ['Exclusão','Eliminação'], ['exclusão','eliminação'], ['Excluído','Eliminado'], ['excluído','eliminado'], ['Excluída','Eliminada'], ['excluída','eliminada'],
  ['Você pode','Pode'], ['você pode','pode'], ['Você deseja','Pretende'], ['você deseja','pretende'], ['Você tem','Tem'], ['você tem','tem'], ['Você não','Não'], ['você não','não'], ['Você está','Está'], ['você está','está'],
  ['Backup','Cópia de segurança'], ['backup','cópia de segurança']
];
for (const [key, value] of Object.entries(base)) {
  if (typeof value !== 'string') continue;
  let translated = value;
  for (const [from, to] of words) translated = translated.replace(new RegExp(`(?<![\\p{L}])${from}(?![\\p{L}])`, 'gu'), to);
  translated = translated.replace(/suas ajustes/g, 'os seus ajustes').replace(/Suas ajustes/g, 'Os seus ajustes').replace(/\bas ajustes/g, 'os ajustes').replace(/\bdas ajustes/g, 'dos ajustes').replace(/às ajustes/g, 'aos ajustes').replace(/\ba lixo/g, 'o lixo').replace(/\bda lixo/g, 'do lixo').replace(/\bna lixo/g, 'no lixo').replace(/\bo cópia de segurança/g, 'a cópia de segurança').replace(/\bdo cópia de segurança/g, 'da cópia de segurança').replace(/\bum cópia de segurança/g, 'uma cópia de segurança').replace(/(Cópia de segurança|cópia de segurança) exportado/g, '$1 exportada').replace(/(Cópia de segurança|cópia de segurança) importado/g, '$1 importada').replace(/(Cópia de segurança|cópia de segurança) inválido/g, '$1 inválida').replace(/Restauração/g, 'Restauro').replace(/restauração/g, 'restauro');
  if (translated !== value) pt[key] = translated;
}
Object.assign(pt, {
  settings: 'Ajustes', settings_modal_title: 'Ajustes', settings_update_failed: 'Não foi possível atualizar os seus ajustes. Tente novamente mais tarde.',
  search: 'Pesquisar', search_documents: 'Pesquisar documentos...', search_placeholder: 'Pesquisar documentos...', search_fonts: 'Pesquisar tipos de letra',
  font_settings: 'Ajustes do tipo de letra', font_settings_none: 'Este tipo de letra não tem ajustes disponíveis.', font_settings_hint: 'As alterações aplicam-se ao texto selecionado ou ao parágrafo atual.',
  font_settings_selection_hint: 'Aplica-se apenas ao texto selecionado ou ao texto escrito a seguir na posição do cursor.', font_settings_defaults_hint: 'As predefinições aplicam-se a todos os documentos. A formatação existente do texto é preservada.',
  default_font_settings_label: 'Tipo de letra predefinido:', default_font_updated: 'Tipo de letra predefinido atualizado.', default_font_desc: 'Escolha o tipo de letra predefinido para os editores que abrir a seguir.',
  settings_nav_backup: 'Cópias de segurança', backup_restore: 'Cópias de segurança e restauro', export_backup: 'Exportar cópia de segurança', import_backup: 'Importar cópia de segurança',
  backup_exported: 'Cópia de segurança exportada.', backup_imported: 'Cópia de segurança importada.', failed_import_backup: 'Falha ao importar a cópia de segurança.', failed_read_backup: 'Falha ao ler o ficheiro da cópia de segurança.',
  backup_settings_desc: 'Exporte ou restaure todos os documentos localmente.', settings_nav_backup_desc: 'Exportar e restaurar documentos', trash_settings: 'Ajustes do lixo', trash_settings_saved: 'Ajustes do lixo guardados.',
  upload_file: 'Carregar ficheiro', upload_file_desc: 'Adicione um ficheiro local e guarde-o de forma privada.', upload_music_file: 'Carregar ficheiro de música', upload_video_file: 'Carregar ficheiro de vídeo',
  settings_appearance_desc: 'Tema, idioma, disposição, destaque e aspeto predefinido do editor.', theme_settings_desc: 'Utilize o tema do sistema ou escolha o seu próprio aspeto.', settings_editor_desc: 'Assistência inteligente, verificação ortográfica e controlos de densidade do editor.',
  fmt_spoiler: 'Texto oculto', online: 'Em linha', mini_player: 'Minileitor'
});
for (const [locale, values] of [['pt-BR', br], ['pt-PT', pt]]) fs.writeFileSync(path.join(folder, `${locale}.json`), JSON.stringify(values, null, 2) + '\n');
const file = path.join(folder, 'index.json'), index = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const locale of ['pt-BR','pt-PT']) { if (!index.languages.includes(locale)) index.languages.push(locale); index.fallbacks[locale] = 'pt'; }
fs.writeFileSync(file, JSON.stringify(index, null, 2) + '\n');
