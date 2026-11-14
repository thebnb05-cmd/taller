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

export const PHYSICAL_SMARTWATCH_FIELDS: CheckFieldOption[] = [
  { key: 'Cristal / Pantalla', label: 'Cristal / Pantalla', options: ['OK', 'Rayado', 'Trizado', 'Roto', 'Despegado'] },
  { key: 'Caja / Bisel', label: 'Caja / Bisel', options: ['OK', 'Rayado', 'Golpeado', 'Oxidado'] },
  { key: 'Tapa trasera / Sensores', label: 'Tapa trasera / Sensores', options: ['OK', 'Rayada', 'Despegada', 'Rota'] },
  { key: 'Corona / Botón lateral', label: 'Corona / Botón lateral', options: ['OK', 'Trabada', 'Faltante', 'Dañada'] },
  { key: 'Malla / Enganches', label: 'Malla / Enganches', options: ['OK', 'Sin malla', 'Rotos', 'Gastada'] },
  { key: 'Pines de carga', label: 'Pines de carga', options: ['OK', 'Sulfatados', 'Hundidos', 'Carga inalámbrica'] },
  { key: 'Humedad / Agua', label: 'Humedad / Agua', options: ['No', 'Condensación', 'Mojado'] },
  { key: 'Reparación anterior', label: 'Reparación anterior', options: ['No', 'Sí'] },
];

export const PHYSICAL_HEADPHONES_FIELDS: CheckFieldOption[] = [
  { key: 'Estuche / Caja de carga', label: 'Estuche / Caja de carga', options: ['OK', 'Rayado', 'Roto', 'Sin estuche'] },
  { key: 'Carcasa / Auriculares', label: 'Carcasa / Auriculares', options: ['OK', 'Rayada', 'Rota', 'Despegada'] },
  { key: 'Almohadillas / Gomas', label: 'Almohadillas / Gomas', options: ['OK', 'Gastadas', 'Faltantes', 'No tiene'] },
  { key: 'Vincha / Diadema', label: 'Vincha / Diadema', options: ['OK', 'Floja', 'Quebrada', 'No tiene'] },
  { key: 'Pines / Puerto de carga', label: 'Pines / Puerto de carga', options: ['OK', 'Sucios', 'Hundidos', 'Dañados'] },
  { key: 'Cable / Ficha Jack 3.5', label: 'Cable / Ficha Jack 3.5', options: ['OK', 'Pelado', 'Doblada', 'No tiene'] },
  { key: 'Malla / Rejilla acústica', label: 'Malla / Rejilla acústica', options: ['OK', 'Sucia / Tapada', 'Rota'] },
  { key: 'Humedad / Óxido', label: 'Humedad / Óxido', options: ['No', 'Leve', 'Severa'] },
  { key: 'Reparación anterior', label: 'Reparación anterior', options: ['No', 'Sí'] },
];

export const PHYSICAL_NOTEBOOK_FIELDS: CheckFieldOption[] = [
  { key: 'Pantalla / Display', label: 'Pantalla / Display', options: ['OK', 'Rayada', 'Manchas / Líneas', 'Rota'] },
  { key: 'Bisagras / Apertura', label: 'Bisagras / Apertura', options: ['OK', 'Duras', 'Flojas', 'Rotas'] },
  { key: 'Carcasa / Tapa / Base', label: 'Carcasa / Tapa / Base', options: ['OK', 'Rayada', 'Partida', 'Falta tapa'] },
  { key: 'Teclado físico', label: 'Teclado físico', options: ['OK', 'Teclas faltantes', 'Gastado', 'Con líquido'] },
  { key: 'Touchpad / Palmrest', label: 'Touchpad / Palmrest', options: ['OK', 'Rayado', 'Hundido', 'Despegado'] },
  { key: 'Puerto de carga / Pin', label: 'Puerto de carga / Pin', options: ['OK', 'Flojo', 'Sucio', 'Dañado'] },
  { key: 'Puertos USB / HDMI', label: 'Puertos USB / HDMI', options: ['OK', 'Dañados', 'Uno o más rotos'] },
  { key: 'Tornillos completos', label: 'Tornillos completos', options: ['Sí', 'Faltan algunos', 'Sin tornillos'] },
  { key: 'Humedad / Óxido', label: 'Humedad / Óxido', options: ['No', 'Leve', 'Severa'] },
  { key: 'Reparación anterior', label: 'Reparación anterior', options: ['No', 'Sí'] },
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
  { key: 'Enciende / Arranca', label: 'Enciende / Arranca', options: ['OK', 'No enciende', 'Se apaga', 'Solo con cargador'] },
  { key: 'Imagen en pantalla', label: 'Imagen en pantalla', options: ['OK', 'Sin imagen', 'Parpadea / Líneas', 'Oscura / Backlight'] },
  { key: 'Salida HDMI / Video ext.', label: 'Salida HDMI / Video ext.', options: ['OK', 'Sin señal', 'No probado'] },
  { key: 'Batería / Carga', label: 'Batería / Carga', options: ['OK', 'No carga', 'Dura poco', 'Sin batería / Hinchada'] },
  { key: 'Teclado y Touchpad', label: 'Teclado y Touchpad', options: ['OK', 'Falla teclado', 'Falla touchpad', 'Fallan ambos'] },
  { key: 'Cooler / Temperatura', label: 'Cooler / Temperatura', options: ['OK', 'Ruidoso', 'Sobrecalienta', 'No gira'] },
  { key: 'Disco (SSD / HDD)', label: 'Disco (SSD / HDD)', options: ['OK', 'Lento / Falla', 'No detecta', 'Sin disco'] },
  { key: 'WiFi / Bluetooth / Red', label: 'WiFi / Bluetooth / Red', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Audio / Mic / Webcam', label: 'Audio / Mic / Webcam', options: ['OK', 'Sin audio', 'Falla mic/cam', 'No probado'] },
  { key: 'Sistema operativo', label: 'Sistema operativo', options: ['OK', 'No inicia', 'Lento / Virus', 'Sin SO'] },
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

export const FUNCTIONAL_SMARTWATCH_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende / Imagen', label: 'Enciende / Imagen', options: ['OK', 'No enciende', 'Pantalla negra', 'Con líneas'] },
  { key: 'Touch / Táctil', label: 'Touch / Táctil', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Carga / Batería', label: 'Carga / Batería', options: ['OK', 'No carga', 'Dura poco', 'Hinchada'] },
  { key: 'Corona / Botones', label: 'Corona / Botones', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Bluetooth / Vinculación', label: 'Bluetooth / Vinculación', options: ['OK', 'No vincula', 'No probado'] },
  { key: 'Sensores (Ritmo / Pasos)', label: 'Sensores (Ritmo / Pasos)', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Audio / Micrófono', label: 'Audio / Micrófono', options: ['OK', 'Falla', 'No tiene'] },
  { key: 'Vibración', label: 'Vibración', options: ['OK', 'Falla', 'No probado'] },
];

export const FUNCTIONAL_HEADPHONES_FIELDS: CheckFieldOption[] = [
  { key: 'Enciende / Vincula BT', label: 'Enciende / Vincula BT', options: ['OK', 'No enciende', 'No vincula', 'Cableado'] },
  { key: 'Sonido lado Izq. (L)', label: 'Sonido lado Izq. (L)', options: ['OK', 'Bajo', 'Distorsiona', 'Sin audio'] },
  { key: 'Sonido lado Der. (R)', label: 'Sonido lado Der. (R)', options: ['OK', 'Bajo', 'Distorsiona', 'Sin audio'] },
  { key: 'Carga del estuche', label: 'Carga del estuche', options: ['OK', 'No carga', 'Dura poco', 'Sin estuche'] },
  { key: 'Carga de auriculares', label: 'Carga de auriculares', options: ['OK', 'No carga L', 'No carga R', 'No cargan'] },
  { key: 'Micrófono / Llamadas', label: 'Micrófono / Llamadas', options: ['OK', 'Falla', 'No tiene'] },
  { key: 'Táctil / Botones', label: 'Táctil / Botones', options: ['OK', 'Falla', 'No probado'] },
  { key: 'Cancelación ruido (ANC)', label: 'Cancelación ruido (ANC)', options: ['OK', 'Falla', 'No tiene'] },
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
  if (deviceType === 'Smartwatch') {
    return PHYSICAL_SMARTWATCH_FIELDS;
  }
  if (deviceType === 'Auriculares') {
    return PHYSICAL_HEADPHONES_FIELDS;
  }
  if (deviceType === 'Notebook') {
    return PHYSICAL_NOTEBOOK_FIELDS;
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
  if (deviceType === 'Smartwatch') {
    return FUNCTIONAL_SMARTWATCH_FIELDS;
  }
  if (deviceType === 'Auriculares') {
    return FUNCTIONAL_HEADPHONES_FIELDS;
  }
  if (deviceType === 'Notebook') {
    return FUNCTIONAL_NOTEBOOK_FIELDS;
  }
  if (deviceType === 'Consola / joystick') {
    return FUNCTIONAL_CONSOLE_FIELDS;
  }
  return FUNCTIONAL_DEFAULT_FIELDS;
}
