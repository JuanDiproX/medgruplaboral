from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
import pypdfium2 as pdfium

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf'; OUT.mkdir(parents=True,exist_ok=True)
for name,file in [('Body','arial.ttf'),('Bold','arialbd.ttf'),('Display','georgia.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
W,H=595.28,841.89
INK='#182839'; MUTED='#546579'; BLUE='#477FB7'; PINK='#B51959'; MIST='#EFF3F7'
pdf=OUT/'MEDGRUP-Propuesta-London-Supply.pdf'
c=canvas.Canvas(str(pdf),pagesize=(W,H))
c.setTitle('MEDGRUP | Propuesta de medicina laboral para London Supply')
c.setAuthor('MEDGRUP')

def text(s,x,y,w,size=11,font='Body',color=INK,leading=None):
    p=Paragraph(s,ParagraphStyle('p',fontName=font,fontSize=size,leading=leading or size*1.45,textColor=HexColor(color)))
    _,height=p.wrap(w,H)
    assert y+height<825, (s,y,height)
    p.drawOn(c,x,H-y-height)
    return y+height
def line(y):
    c.setStrokeColor(HexColor('#D8E1EA'));c.setLineWidth(.6);c.line(42,H-y,W-42,H-y)
def box(x,y,w,h,color=MIST):
    c.setFillColor(HexColor(color));c.roundRect(x,H-y-h,w,h,12,stroke=0,fill=1)
def label(s,y,x=42): text(s,x,y,500,9,'Bold',BLUE,12)
def header(page):
    c.drawImage(str(ROOT/'public/logo.png'),42,H-78,width=152,height=48,mask='auto',preserveAspectRatio=True)
    text('PROPUESTA COMERCIAL',365,39,190,9,'Bold',MUTED)
    text('London Supply SACIFI',365,56,190,10,'Body')
    line(96)
    line(796)
    text('MEDGRUP · Medicina laboral · Tierra del Fuego',42,808,440,8,color=MUTED)
    text(f'{page} / 2',517,808,40,8,color=MUTED)

header(1)
label('TELEMEDICINA + GEOLOCALIZACIÓN',119)
text('Cuidar a tu equipo.<br/>Conectar la atención.',42,148,510,32,'Display',leading=39)
text('Una propuesta de medicina laboral para acompañar a London Supply en Río Grande y Ushuaia.',42,245,480,13,leading=19)

box(42,313,511,173)
label('LA NECESIDAD QUE NOS COMPARTIERON',333,60)
text('Control de ausentismo por telemedicina',60,357,470,19,'Display')
text('Proponemos evaluar al colaborador por videollamada, con verificación de ubicación al ingresar: revisión del certificado y sus antecedentes, entrevista clínica e informe médico laboral. El profesional determina si la modalidad resulta adecuada para el caso.',60,392,470,11)
text('Dr. Raúl Barboza · Médico psiquiatra / Médico del trabajo',60,461,475,10,'Bold')

label('COBERTURA EN AMBAS CIUDADES',516)
text('Río Grande y Ushuaia,<br/>bajo una misma coordinación.',42,541,510,23,'Display',leading=29)
text('La telemedicina permite asistir Río Grande y Ushuaia de manera simultánea, sin traslados para la consulta online. Centralizamos los turnos, la evaluación médica y el seguimiento de los casos en una misma plataforma.',42,611,505,11)
text('La geolocalización permite verificar la ubicación del trabajador al ingresar a la atención, con su autorización. Vincula la consulta con el lugar informado y aporta trazabilidad al control; no implica un seguimiento continuo de sus movimientos.',42,669,505,10.5)
line(737)
text('SOLICITUD',42,752,150,9,'Bold',BLUE)
text('UBICACIÓN + CONSULTA',219,752,150,9,'Bold',BLUE)
text('INFORME Y SEGUIMIENTO',389,752,170,9,'Bold',BLUE)
text('Caso y documentación',42,769,155,9,color=MUTED)
text('Ingreso y videollamada',219,769,155,9,color=MUTED)
text('Consulta desde el portal',389,769,170,9,color=MUTED)
c.showPage()

# Header drawn after content on the second page
label('SERVICIOS Y GESTIÓN DIGITAL',118)
text('Atención médica.<br/>Información a mano.',42,145,510,28,'Display',leading=34)
text('Una cartera de servicios que podemos adaptar a las necesidades de su empresa.',42,225,510,11)

services=[
('Ausentismo y licencias','Revisión de certificados, controles médicos y seguimiento de los casos.'),
('Psiquiatría laboral','Evaluaciones y auditorías psiquiátricas, con enfoque médico laboral.'),
('Consultas y juntas médicas','Consultas por videollamada y coordinación de juntas médicas online.'),
('Aptos y exámenes laborales','Aptos médicos, exámenes preocupacionales y periódicos, según el puesto y los estudios requeridos.')]
for i,(title,body) in enumerate(services):
    x=42+(i%2)*263;y=273+(i//2)*98
    line_y=y+83
    text(title,x,y,244,12,'Bold')
    text(body,x,y+25,242,10.5)

box(42,479,511,100)
label('PORTAL PARA LA EMPRESA',495,59)
text('Turnos y videollamadas · Seguimiento de casos · Informes y actas',59,519,472,11,'Bold')
text('Acceso a la documentación habilitada según los permisos de cada usuario, con resguardo de la confidencialidad médica.',59,545,472,10)

label('PROPUESTA ECONÓMICA',602)
text('$1.200.000',42,627,270,30,'Display')
text('ARS / por mes',339,641,205,12,'Bold',MUTED)
text('Abono mensual de medicina laboral. Las prestaciones incluidas, los volúmenes de atención, los estudios adicionales y el tratamiento impositivo se definirán en la propuesta final, de acuerdo con la dotación y las necesidades de London Supply.',42,672,510,9.5)

line(716)
text('Coordinemos una demostración',42,728,510,17,'Display')
text('Les proponemos una reunión breve para mostrar el ingreso con geolocalización, la videollamada y el seguimiento desde el portal. Podemos recorrer un caso de ejemplo y definir juntos el alcance del servicio.',42,754,510,9.5,leading=12)
header(2)
c.save()

doc=pdfium.PdfDocument(str(pdf))
for i in range(len(doc)):
    doc[i].render(scale=1.5).to_pil().save(OUT/f'london-proposal-page-{i+1}.png')
print(pdf)
