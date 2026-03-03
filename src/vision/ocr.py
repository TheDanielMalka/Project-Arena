import pytesseract
from PIL import Image, ImageOps

img = Image.open("src/vision/templates/cs2/competitive-gaming-team-preparation.webp")

top_team = img.crop((230, 128, 420, 220))
top_team = top_team.resize((top_team.width * 3, top_team.height * 3))
top_team = top_team.convert("L")
top_team = ImageOps.invert(top_team)
top_team.save("src/vision/templates/debug_crop.png")

text = pytesseract.image_to_string(top_team)
print(f"Result: [{text}]")