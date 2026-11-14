export interface CheckFieldOption {
  key: string;
  label: string;
  options: string[];
}

export const PHYSICAL_DEFAULT_FIELDS: CheckFieldOption[] = [
  { key: 'Pantalla', label: 'Pantalla', options: ['OK', 'Rayada', 'Rota'] },
  { key: 'Tapa trasera', label: 'Tapa trasera', options: ['OK', 'Despegada', 'Rayada', 'Rota'] },
  { key: 'Marco / Bisel', label: 'Marco / Bisel', options: ['OK', 'Doblado', 'Dañado'] },
  { key: 'Corrosión / Óxido', label: 'Corrosión / Óxido', options: ['No', 'Leve', 'Severa'] },
  { key: 'Puerto de carga', label: 'Puerto de carga', options: ['OK', 'Sucio', 'Dañado'] },
  { key: 'Reparación anterior', label: 'Reparación anterior', options: ['No', 'Sí'] },
  { key: 'Estado general', label: 'Estado general', options: ['OK', 'Regular', 'Malo'] },
  { key: 'Rayones', label: 'Rayones', options: ['No', 'Leves', 'Severos'] },
  { key: 'Golpes visibles', label: 'Golpes visibles', options: ['No', 'Leves', 'Severos'] },
];

export const PHYSICAL_SIMPLE_FIELDS: CheckFieldOption[] = [
  { key: 'Estado general', label: 'Estado general', options: ['OK', 'Regular', 'Malo'] },
  { key: 'Rayones', label: 'Rayones', options: ['No', 'Leves', 'Severos'] },
  { key: 'Golpes visibles', label: 'Golpes visibles', options: ['No', 'Leves', 'Severos'] },
];

export const PHYSICAL_PC_FIELDS: CheckFieldOption[] = [
  { key: 'Gabinete / Chasis', label: 'Gabinete / Chasis', options: ['OK', 'Rayado', 'Abollado', 'Sin tapa'] },
  { key: 'Tapa lateral / Vidrio', label: 'Tapa lateral / Vidrio', options: ['OK', 'Rayado', 'Roto', 'Faltante'] },
  { key: 'Polvo / Suciedad', label: 'Polvo / Suciedad', options: ['Limpio', 'Moderado', 'Excesivo'] },
  { key: 'Cables internos', label: 'Cables internos', options: ['OK', 'Sueltos', 'Dañados'] },
  { key: 'Humedad / Óxido', label: 'Humedad / Óxido', options: ['No', 'Leve', 'Severa'] },
  { key: 'Reparación anterior', label: 'Reparación anterior', options: ['No', 'Sí'] },
  { key: 'Golpes visibles', label: 'Golpes visibles', options: ['No', 'Leves', 'Severos'] },
];

export const PHYSICAL_SPEAKER_FIELDS: CheckFieldOption[] = [
  { key: 'Carcasa / Gabinete', label: 'Carcasa / Gabinete', options: ['OK', 'Rayada', 'Abollada', 'Rota'] },
  { key: 'Rejilla / Tela frontal', label: 'Rejilla / Tela frontal', options: ['OK', 'Hundida', 'Rota', 'Sin rejilla'] },
  { key: 'Cono / Membrana', label: 'Cono / Membrana', options: ['OK', 'Despegado', 'Roto', 'No visible'] },
  { key: 'Pin / Puerto de carga', label: 'Pin / Puerto de carga', options: ['OK', 'Flojo', 'Sucio', 'Dañado'] },
  { key: 'Botones / Perillas', label: 'Botones / Perillas', options: ['OK', 'Faltante', 'Hundidos'] },
  { key: 'Humedad / Óxido', label: 'Humedad / Óxido', options: ['No', 'Leve', 'Severa'] },
  { key: 'Reparación anterior', label: 'Reparación anterior', options: ['No', 'Sí'] },
  { key: 'Golpes visibles', label: 'Golpes visibles', options: ['No', 'Leves', 'Severos'] },
];

export const PHYSICAL_CONSOLE_FIELDS: CheckFieldOption[] = [
  { key: 'Carcasa / Chasis', label: 'Carcasa / Chasis', options: ['OK', 'Rayada', 'Rota', 'Abierta'] },
  { key: 'Sello de garantía', label: 'Sello de garantía', options: ['Intacto', 'Roto / Abierto', 'Sin sello'] },
  { key: 'Puerto HDMI / Video', label: 'Puerto HDMI / Video', options: ['OK', 'Flojo', 'Dañado', 'No aplica'] },
  { key: 'Puertos USB / Carga', label: 'Puertos USB / Carga', options: ['OK', 'Flojo', 'Dañado'] },
  { key: 'Sticks / Analógicos', label: 'Sticks / Analógicos', options: ['OK', 'Gastados', 'Rotos', 'No aplica'] },
  { key: 'Polvo / Suciedad', label: 'Polvo / Suciedad', options: ['Limpio', 'Moderado', 'Excesivo'] },
  { key: 'Reparación anterior', label: 'Reparación anterior', options: ['No', 'Sí'] },
  { key: 'Golpes visibles', label: 'Golpes visibles', options: ['No', 'Leves', 'Severos'] },
];

export const FUNCTIONAL_DEFAULT_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende', label: 'Enciende', options: ['OK', 'No', 'No probado'] },
  { key: 'Touch / Táctil', label: 'Touch / Táctil', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Carga', label: 'Carga', options: ['OK', 'No', 'No probado'] },
  { key: 'Sonido', label: 'Sonido', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Micrófono', label: 'Micrófono', options: ['OK', 'Falla', 'No probado'] },
  { key: 'WiFi', label: 'WiFi', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Botones', label: 'Botones', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Huella / FaceID', label: 'Huella / FaceID', options: ['OK', 'Falla', 'No tiene'] },
];

export const FUNCTIONAL_NOTEBOOK_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende', label: 'Enciende', options: ['OK', 'No', 'No probado'] },
  { key: 'Lector de discos', label: 'Lector de discos', options: ['OK', 'Falla', 'No tiene'] },
  { key: 'Imagen HDMI', label: 'Imagen HDMI', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Ventilador', label: 'Ventilador', options: ['OK', 'Falla', 'No probado'] },
];

export const FUNCTIONAL_PC_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende / Arranca', label: 'Enciende / Arranca', options: ['OK', 'No enciende', 'Se reinicia'] },
  { key: 'Da video / Imagen', label: 'Da video / Imagen', options: ['OK', 'Sin señal', 'Artefactos'] },
  { key: 'Fuente de poder', label: 'Fuente de poder', options: ['OK', 'Falla', 'No probada'] },
  { key: 'Coolers / Ventilación', label: 'Coolers / Ventilación', options: ['OK', 'Ruidosos', 'No giran'] },
  { key: 'Disco (SSD / HDD)', label: 'Disco (SSD / HDD)', options: ['OK', 'Lento / Falla', 'No detecta'] },
  { key: 'Memoria RAM', label: 'Memoria RAM', options: ['OK', 'Falla', 'No probada'] },
  { key: 'Puertos USB / Audio', label: 'Puertos USB / Audio', options: ['OK', 'Falla parcial', 'No funcionan'] },
  { key: 'Red (LAN / WiFi)', label: 'Red (LAN / WiFi)', options: ['OK', 'Falla', 'No tiene'] },
  { key: 'Sistema operativo', label: 'Sistema operativo', options: ['OK', 'No inicia', 'Lento / Virus'] },
];

export const FUNCTIONAL_CONSOLE_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende', label: 'Enciende', options: ['OK', 'No', 'Luz azul / Parpadea', 'Se apaga'] },
  { key: 'Imagen HDMI / Video', label: 'Imagen HDMI / Video', options: ['OK', 'Sin señal', 'Artefactos', 'No aplica'] },
  { key: 'Lector de discos', label: 'Lector de discos', options: ['OK', 'No lee', 'Traba disco', 'No tiene'] },
  { key: 'Ventilador / Temp.', label: 'Ventilador / Temp.', options: ['OK', 'Ruidoso', 'Sobrecalienta', 'No gira'] },
  { key: 'Drift en analógicos', label: 'Drift en analógicos', options: ['OK', 'Drift Izq.', 'Drift Der.', 'Ambos', 'No probado'] },
  { key: 'Botones / Gatillos', label: 'Botones / Gatillos', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Carga / Batería', label: 'Carga / Batería', options: ['OK', 'No carga', 'Dura poco', 'No probado'] },
  { key: 'WiFi / Bluetooth', label: 'WiFi / Bluetooth', options: ['OK', 'No conecta', 'No probado'] },
  { key: 'Audio / Jack', label: 'Audio / Jack', options: ['OK', 'Falla', 'No probado'] },
];

export const FUNCTIONAL_SPEAKER_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende', label: 'Enciende', options: ['OK', 'No', 'No probado'] },
  { key: 'Carga / Batería', label: 'Carga / Batería', options: ['OK', 'No carga', 'Dura poco', 'Solo enchufado'] },
  { key: 'Sonido / Audio', label: 'Sonido / Audio', options: ['OK', 'Distorsiona', 'Sin graves', 'Mudo'] },
  { key: 'Bluetooth', label: 'Bluetooth', options: ['OK', 'No conecta', 'No tiene'] },
  { key: 'Entrada Aux / USB / SD', label: 'Entrada Aux / USB / SD', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Luces LED', label: 'Luces LED', options: ['OK', 'No prenden', 'No tiene'] },
  { key: 'Entrada micrófono', label: 'Entrada micrófono', options: ['OK', 'Falla', 'No tiene'] },
  { key: 'Botones / Volumen', label: 'Botones / Volumen', options: ['OK', 'Falla', 'No probado'] },
];

export function getPhysicalCheckFields(deviceType?: string): CheckFieldOption[] {
  if (deviceType === 'PC de escritorio') {
    return PHYSICAL_PC_FIELDS;
  }
  if (deviceType === 'Parlante') {
    return PHYSICAL_SPEAKER_FIELDS;
  }
  if (deviceType === 'Consola / joystick') {
    return PHYSICAL_CONSOLE_FIELDS;
  }
  if (deviceType === 'Notebook') {
    return PHYSICAL_SIMPLE_FIELDS;
  }
  return PHYSICAL_DEFAULT_FIELDS;
}

export function getFunctionalCheckFields(deviceType?: string): CheckFieldOption[] {
  if (deviceType === 'PC de escritorio') {
    return FUNCTIONAL_PC_FIELDS;
  }
  if (deviceType === 'Parlante') {
    return FUNCTIONAL_SPEAKER_FIELDS;
  }
  if (deviceType === 'Notebook') {
    return FUNCTIONAL_NOTEBOOK_FIELDS;
  }
  if (deviceType === 'Consola / joystick') {
    return FUNCTIONAL_CONSOLE_FIELDS;
  }
  return FUNCTIONAL_DEFAULT_FIELDS;
}
